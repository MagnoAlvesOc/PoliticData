"""PoliticData: local leadership and public aggregate electoral reporting tool.
Runs with Python 3.10+ standard library only. Localhost by default.
"""
import csv, hashlib, hmac, io, json, os, secrets, sqlite3, time, base64, zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE=Path(__file__).resolve().parent
DB=Path(os.environ.get('POLITICDATA_DB',str(BASE/'politicdata.db')))
SESSIONS={}
MAX_BODY=5_000_000
USE_POSTGRES=bool(os.environ.get('DATABASE_URL'))

def connect():
    if USE_POSTGRES:
        from pg_adapter import PgConnection
        return PgConnection(os.environ['DATABASE_URL'])
    db=sqlite3.connect(DB,timeout=12)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    return db

def init():
    if USE_POSTGRES:
        with connect() as db:
            db.executescript((BASE/'neon_schema.sql').read_text(encoding='utf-8'))
            initialize_admin(db)
        return
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS leaders(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT,region TEXT,neighborhood TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS meetings(id INTEGER PRIMARY KEY,leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,meeting_date TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'reunião',summary TEXT NOT NULL,next_action TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS demands(id INTEGER PRIMARY KEY,leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,opened_at TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','em andamento','atendida','recusada')),resolution TEXT,resolved_at TEXT,estimated_cost REAL NOT NULL DEFAULT 0 CHECK(estimated_cost>=0),actual_cost REAL NOT NULL DEFAULT 0 CHECK(actual_cost>=0));
        CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,expense_date TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,amount REAL NOT NULL CHECK(amount>=0),receipt_ref TEXT,compliance_note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS elections(id INTEGER PRIMARY KEY,election_year INTEGER NOT NULL,round INTEGER NOT NULL DEFAULT 1,office TEXT NOT NULL,municipality TEXT NOT NULL,neighborhood TEXT,zone TEXT,section TEXT,polling_place TEXT,candidate TEXT NOT NULL,votes INTEGER NOT NULL CHECK(votes>=0),eligible INTEGER,turnout INTEGER,latitude REAL,longitude REAL,source TEXT NOT NULL,UNIQUE(election_year,round,office,municipality,zone,section,candidate));
        CREATE INDEX IF NOT EXISTS idx_meet_leader ON meetings(leader_id,meeting_date);
        CREATE INDEX IF NOT EXISTS idx_demand_leader ON demands(leader_id,status);
        CREATE INDEX IF NOT EXISTS idx_vote_geo ON elections(election_year,municipality,zone,section);
        ''')
        # Evolução incremental do banco existente.
        demand_cols={r[1] for r in db.execute('PRAGMA table_info(demands)')}
        if 'due_date' not in demand_cols:
            db.execute('ALTER TABLE demands ADD COLUMN due_date TEXT')
        expense_cols={r[1] for r in db.execute('PRAGMA table_info(expenses)')}
        if 'review_status' not in expense_cols:
            db.execute("ALTER TABLE expenses ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pendente'")
        leader_cols={r[1] for r in db.execute('PRAGMA table_info(leaders)')}
        for col in ('nickname','activity','electoral_zone','electoral_section','address'):
            if col not in leader_cols:
                db.execute(f'ALTER TABLE leaders ADD COLUMN {col} TEXT')
        db.execute("""CREATE TABLE IF NOT EXISTS contacts(
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, neighborhood TEXT,
            notes TEXT, leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_contacts_leader ON contacts(leader_id)")
        leader_cols={r[1] for r in db.execute('PRAGMA table_info(leaders)')}
        if 'archived' not in leader_cols: db.execute("ALTER TABLE leaders ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
        count=db.execute('SELECT count(*) FROM users').fetchone()[0]
        if count==0:
            user=os.environ.get('POLITICDATA_ADMIN','admin')
            password=os.environ.get('POLITICDATA_PASSWORD')
            if not password:
                password=secrets.token_urlsafe(14)
                print(f'\nUSUÁRIO INICIAL: {user}\nSENHA INICIAL: {password}\nGuarde a senha. Ela não será exibida novamente.\n',flush=True)
            salt=secrets.token_hex(16)
            hashed=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),260000).hex()
            db.execute('INSERT INTO users(username,password_hash,salt) VALUES(?,?,?)',(user,hashed,salt))

def initialize_admin(db):
    if db.execute('SELECT count(*) FROM users').fetchone()['count']>0:return
    user=os.environ.get('POLITICDATA_ADMIN','admin')
    password=os.environ.get('POLITICDATA_PASSWORD')
    if not password or len(password)<12:
        raise RuntimeError('Defina POLITICDATA_PASSWORD com no mínimo 12 caracteres antes de ativar PostgreSQL')
    salt=secrets.token_hex(16)
    hashed=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),260000).hex()
    db.execute('INSERT INTO users(username,password_hash,salt) VALUES(?,?,?)',(user,hashed,salt))

def restore_official_elections():
    """Restaurar base pública oficial a partir do CSV versionado no repositório.
    Faz upsert idempotente; jamais elimina cadastros ou dados administrativos.
    """
    source_file=BASE/'data'/'politicdata_sao_luis_2024_CORRIGIDO.csv'
    if not source_file.is_file():
        source_file=BASE.parent/'data'/'politicdata_sao_luis_2024_CORRIGIDO.csv'
    if not source_file.is_file():
        print('Base oficial ainda não disponível no pacote: '+str(source_file),flush=True)
        return
    with connect() as db:
        present=db.execute("SELECT count(*) FROM elections WHERE election_year=2024 AND municipality='São Luís' AND candidate='TOTAL VOTOS NOMINAIS - VEREADOR'").fetchone()['count'] if USE_POSTGRES else db.execute("SELECT count(*) FROM elections WHERE election_year=2024 AND municipality='São Luís' AND candidate='TOTAL VOTOS NOMINAIS - VEREADOR'").fetchone()[0]
        if present>=2173:
            print('Base TSE São Luís 2024 já cadastrada: '+str(present)+' registros',flush=True)
            return
        imported=0
        with source_file.open('r',encoding='utf-8-sig',newline='') as f:
            reader=csv.DictReader(f)
            expected={'election_year','round','office','municipality','zone','section','candidate','votes','source'}
            if not expected.issubset(set(reader.fieldnames or [])):
                raise ValueError('CSV TSE empacotado possui colunas inválidas')
            for x in reader:
                if x.get('municipality')!='São Luís' or str(x.get('election_year'))!='2024':
                    continue
                def nullable_int(key):
                    val=str(x.get(key) or '').strip()
                    return int(val) if val else None
                def nullable_float(key):
                    val=str(x.get(key) or '').strip()
                    return float(val) if val else None
                db.execute("""INSERT INTO elections(election_year,round,office,municipality,neighborhood,zone,section,polling_place,candidate,votes,eligible,turnout,latitude,longitude,source)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(election_year,round,office,municipality,zone,section,candidate)
                    DO UPDATE SET neighborhood=excluded.neighborhood,polling_place=excluded.polling_place,
                    votes=excluded.votes,eligible=excluded.eligible,turnout=excluded.turnout,
                    latitude=excluded.latitude,longitude=excluded.longitude,source=excluded.source""",
                    (2024,int(x.get('round') or 1),x['office'],x['municipality'],x.get('neighborhood',''),
                     x['zone'],x['section'],x.get('polling_place',''),x['candidate'],int(x['votes']),
                     nullable_int('eligible'),nullable_int('turnout'),nullable_float('latitude'),nullable_float('longitude'),x['source']))
                imported+=1
        print('Base histórica oficial restaurada: '+str(imported)+' linhas',flush=True)


def parse_excel_base64(data):
    """Lê primeira planilha .xlsx pelo formato Office Open XML, sem dependências."""
    raw=base64.b64decode(data,validate=True)
    if len(raw)>3_000_000:raise ValueError('Arquivo Excel acima de 3 MB')
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names=set(archive.namelist())
        worksheet='xl/worksheets/sheet1.xml'
        if worksheet not in names:raise ValueError('Planilha 1 não encontrada')
        target=[worksheet]+(['xl/sharedStrings.xml'] if 'xl/sharedStrings.xml' in names else [])
        if any(archive.getinfo(n).file_size>15_000_000 for n in target):
            raise ValueError('Planilha descompactada muito grande')
        strings=[]
        if 'xl/sharedStrings.xml' in names:
            root=ET.fromstring(archive.read('xl/sharedStrings.xml'))
            for si in root.findall('m:si',ns):
                strings.append(''.join((t.text or '') for t in si.findall('.//m:t',ns)))
        sheet=ET.fromstring(archive.read(worksheet))
        values=[]
        for row in sheet.findall('.//m:sheetData/m:row',ns):
            d={}
            for cell in row.findall('m:c',ns):
                ref=cell.attrib.get('r','')
                col=''.join(x for x in ref if x.isalpha())
                index=0
                for ch in col:index=index*26+(ord(ch.upper())-64)
                index-=1
                if index<0 or index>150:continue
                typ=cell.attrib.get('t')
                v=cell.find('m:v',ns)
                if typ=='inlineStr':
                    text=''.join(x.text or '' for x in cell.findall('.//m:t',ns))
                else:
                    text=v.text if v is not None and v.text is not None else ''
                    if typ=='s' and text:
                        num=int(text);text=strings[num] if num<len(strings) else ''
                d[index]=text
            if d:values.append(d)
            if len(values)>10005:raise ValueError('Máximo de 10.000 linhas')
        if not values:return []
        keys=[str(values[0].get(j,'')).strip() for j in range(max(values[0])+1)]
        return [{key:str(row.get(j,'')).strip() for j,key in enumerate(keys) if key} for row in values[1:]]

def rows(db,sql,args=()): return [dict(x) for x in db.execute(sql,args).fetchall()]
def check_password(p,salt,expected): return hmac.compare_digest(hashlib.pbkdf2_hmac('sha256',p.encode(),bytes.fromhex(salt),260000).hex(),expected)
def clean(v,maxlen=4000): return str(v or '').strip()[:maxlen]
def real(v):
    try: return max(0,float(v or 0))
    except (TypeError,ValueError): raise ValueError('Valor numérico inválido')
def date_ok(v):
    v=clean(v,10)
    date.fromisoformat(v)
    return v

class Handler(BaseHTTPRequestHandler):
    def send(self,status=200,data=None,content_type='application/json',extra=None):
        raw=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False,default=str).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type+('; charset=utf-8' if content_type.startswith(('text/','application/json')) else ''))
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Permitted-Cross-Domain-Policies','none')
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()')
        self.send_header('Content-Security-Policy',"default-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com; script-src 'self' https://unpkg.com; connect-src 'self' https://*.tile.openstreetmap.org")
        for k,v in extra or []: self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def current(self):
        jar=SimpleCookie()
        try: jar.load(self.headers.get('Cookie',''))
        except Exception: return None
        token=jar.get('pd_session')
        if not token:return None
        s=SESSIONS.get(token.value)
        if not s or s['expires']<time.time():return None
        return s
    def body(self):
        n=int(self.headers.get('Content-Length','0'))
        if n<0 or n>MAX_BODY: raise ValueError('Corpo da requisição muito grande')
        return json.loads(self.rfile.read(n) or b'{}')
    def csrf(self):
        s=self.current()
        return s and hmac.compare_digest(self.headers.get('X-CSRF-Token',''),s['csrf'])
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/': return self.send(200,(BASE/'index.html').read_bytes(),'text/html')
        if path=='/app.js':return self.send(200,(BASE/'app.js').read_bytes(),'text/javascript')
        if path=='/style.css':return self.send(200,(BASE/'style.css').read_bytes(),'text/css')
        if path=='/setores-ibge.geojson':
            candidates=[BASE/'data'/'Setores_Censitarios_Sao_Luis_IBGE_2022.geojson',
                        BASE.parent/'data'/'Setores_Censitarios_Sao_Luis_IBGE_2022.geojson']
            for candidate in candidates:
                if candidate.is_file():
                    return self.send(200,candidate.read_bytes(),'application/geo+json')
            return self.send(404,{'error':'Malha IBGE ainda não foi adicionada ao repositório'})

        if path=='/api/session':
            s=self.current();return self.send(200,{'logged_in':bool(s),'username':s['username'] if s else None,'csrf':s['csrf'] if s else None})
        if not self.current():return self.send(401,{'error':'Autenticação necessária'})
        with connect() as db:
            if path=='/api/dashboard':
                d={}
                for key,sql in [('leaders','SELECT count(*) FROM leaders'),('open_demands',"SELECT count(*) FROM demands WHERE status IN ('aberta','em andamento')"),('resolved_demands',"SELECT count(*) FROM demands WHERE status='atendida'"),('expenses','SELECT coalesce(sum(amount),0) FROM expenses')]:d[key]=db.execute(sql).fetchone()[0]
                d['attention']=rows(db,"""SELECT l.id,l.name,l.neighborhood,MAX(m.meeting_date) last_meeting,CAST(julianday('now')-julianday(MAX(m.meeting_date)) AS INTEGER) days_since FROM leaders l LEFT JOIN meetings m ON l.id=m.leader_id GROUP BY l.id ORDER BY last_meeting IS NOT NULL ASC,last_meeting ASC LIMIT 12""")
                d['alerts']={
                    'old_meetings':rows(db,"""SELECT l.id,l.name,l.neighborhood,MAX(m.meeting_date) last_meeting,
                       CAST(julianday('now')-julianday(MAX(m.meeting_date)) AS INTEGER) days_since
                       FROM leaders l LEFT JOIN meetings m ON l.id=m.leader_id
                       GROUP BY l.id HAVING MAX(m.meeting_date) IS NULL OR MAX(m.meeting_date)<date('now','-30 days')
                       ORDER BY last_meeting IS NOT NULL ASC,last_meeting ASC LIMIT 100"""),
                    'overdue_demands':rows(db,"""SELECT d.id,d.description,d.due_date,d.status,l.name leader_name
                       FROM demands d JOIN leaders l ON l.id=d.leader_id
                       WHERE d.status IN ('aberta','em andamento') AND d.due_date IS NOT NULL AND d.due_date<date('now')
                       ORDER BY d.due_date ASC LIMIT 100"""),
                    'expenses_review':rows(db,"""SELECT e.id,e.expense_date,e.amount,e.category,e.review_status,e.receipt_ref,l.name leader_name
                       FROM expenses e LEFT JOIN leaders l ON l.id=e.leader_id
                       WHERE e.review_status='pendente' OR trim(coalesce(e.receipt_ref,''))=''
                       ORDER BY e.expense_date ASC LIMIT 100""")
                }
                d['demands_by_status']=rows(db,'SELECT status,count(*) total FROM demands GROUP BY status')
                d['expense_by_category']=rows(db,'SELECT category,sum(amount) total FROM expenses GROUP BY category ORDER BY total DESC')
                return self.send(200,d)
            if path=='/api/backup':
                names=['leaders','meetings','demands','expenses','contacts']
                result={'format':'politicdata-backup-v1','created_at':datetime.utcnow().isoformat()+'Z',
                        'tables':{name:rows(db,'SELECT * FROM '+name) for name in names}}
                raw=json.dumps(result,ensure_ascii=False,default=str).encode('utf-8')
                return self.send(200,raw,'application/json',extra=[
                    ('Content-Disposition','attachment; filename="politicdata_backup.json"')])
            if path=='/api/leader-summary':
                return self.send(200,rows(db,"SELECT COALESCE(NULLIF(trim(neighborhood),''),'Não informado') neighborhood,count(*) total FROM leaders GROUP BY COALESCE(NULLIF(trim(neighborhood),''),'Não informado') ORDER BY total DESC"))
            if path=='/api/contacts':
                return self.send(200,rows(db,"SELECT c.*,l.name leader_name FROM contacts c LEFT JOIN leaders l ON l.id=c.leader_id ORDER BY c.name LIMIT 10000"))
            if path=='/api/leaders':return self.send(200,rows(db,'SELECT l.*, (SELECT max(meeting_date) FROM meetings WHERE leader_id=l.id) last_meeting,(SELECT count(*) FROM demands WHERE leader_id=l.id AND status IN (\'aberta\',\'em andamento\')) open_demands FROM leaders l WHERE l.archived=0 ORDER BY l.name'))
            if path=='/api/meetings':return self.send(200,rows(db,'SELECT m.*,l.name leader_name FROM meetings m JOIN leaders l ON l.id=m.leader_id ORDER BY meeting_date DESC,id DESC'))
            if path=='/api/demands':return self.send(200,rows(db,'SELECT d.*,l.name leader_name FROM demands d JOIN leaders l ON l.id=d.leader_id ORDER BY opened_at DESC,id DESC'))
            if path=='/api/expenses':return self.send(200,rows(db,'SELECT e.*,l.name leader_name FROM expenses e LEFT JOIN leaders l ON l.id=e.leader_id ORDER BY expense_date DESC,id DESC'))
            if path=='/api/elections':
                q=parse_qs(urlparse(self.path).query); year=clean(q.get('year',[''])[0]); args=[];where=''
                if year:
                    if not year.isdigit():raise ValueError('Ano inválido')
                    where=' WHERE election_year=?';args=[int(year)]
                dataset=rows(db,'SELECT election_year,round,office,municipality,neighborhood,zone,section,polling_place,candidate,sum(votes) votes,max(latitude) latitude,max(longitude) longitude,source FROM elections'+where+' GROUP BY election_year,round,office,municipality,neighborhood,zone,section,polling_place,candidate ORDER BY election_year DESC,municipality,zone,section LIMIT 6000',args)
                return self.send(200,dataset)
            if path=='/api/years':return self.send(200,rows(db,'SELECT election_year year,count(*) records FROM elections GROUP BY election_year ORDER BY election_year DESC'))
        return self.send(404,{'error':'Rota não encontrada'})
    def do_POST(self):
        path=urlparse(self.path).path
        try:
            if path=='/api/login':
                b=self.body()
                with connect() as db: u=db.execute('SELECT * FROM users WHERE username=?',(clean(b.get('username'),100),)).fetchone()
                if not u or not check_password(clean(b.get('password'),200),u['salt'],u['password_hash']):return self.send(401,{'error':'Credenciais inválidas'})
                token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(24)
                SESSIONS[token]={'username':u['username'],'csrf':csrf,'expires':time.time()+3600*12}
                return self.send(200,{'ok':True,'csrf':csrf},extra=[('Set-Cookie',f'pd_session={token}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=43200')])
            if not self.csrf():return self.send(403,{'error':'Sessão ou token de segurança inválido'})
            if path=='/api/logout':
                jar=SimpleCookie();jar.load(self.headers.get('Cookie',''));token=jar.get('pd_session')
                if token:SESSIONS.pop(token.value,None)
                return self.send(200,{'ok':True},extra=[('Set-Cookie','pd_session=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0')])
            b=self.body()
            if path=='/api/spreadsheet/read':
                return self.send(200,{'rows':parse_excel_base64(b.get('base64',''))})
            with connect() as db:
                if path=='/api/leaders/import':
                    raw=b.get('csv','')
                    if not isinstance(raw,str) or len(raw)>4_000_000: raise ValueError('Arquivo CSV inválido ou muito grande')
                    dialect=csv.Sniffer().sniff(raw[:4096],delimiters=',;\t')
                    reader=csv.DictReader(io.StringIO(raw),dialect=dialect)
                    aliases={'nome':'name','name':'name','apelido':'nickname','nickname':'nickname','telefone':'phone','phone':'phone','bairro':'neighborhood','neighborhood':'neighborhood','regiao':'region','região':'region','region':'region','atuacao':'activity','atuação':'activity','activity':'activity','zona':'electoral_zone','zona eleitoral':'electoral_zone','secao':'electoral_section','sessao':'electoral_section','seção':'electoral_section','endereco':'address','endereço':'address','observacoes':'notes','observações':'notes','notes':'notes'}
                    import unicodedata
                    def canonical(k):
                        k=unicodedata.normalize('NFKD',str(k or '').strip().lower())
                        k=''.join(c for c in k if not unicodedata.combining(c))
                        return aliases.get(k)
                    fieldmap={k:canonical(k) for k in (reader.fieldnames or [])}
                    if 'name' not in fieldmap.values(): raise ValueError('É necessária uma coluna Nome')
                    rejected={'cpf','nome da mae','mae','votos fixos','votos previstos','voto','eleitor'}
                    for k in (reader.fieldnames or []):
                        norm=unicodedata.normalize('NFKD',str(k).lower())
                        norm=''.join(c for c in norm if not unicodedata.combining(c)).strip()
                        if norm in rejected or 'voto' in norm: raise ValueError('A planilha contém campos de eleitores/votos ou identificação desnecessária. Gere uma cópia somente com Nome, Apelido, Telefone, Bairro, Região, Atuação e Observações administrativas.')
                    imported=0; skipped=0
                    for r in reader:
                        if imported+skipped>=5000: raise ValueError('Limite de 5000 linhas por importação')
                        rec={v:clean(r.get(k),150 if v!='notes' else 4000) for k,v in fieldmap.items() if v}
                        if not rec.get('name'): skipped+=1;continue
                        exists=db.execute('SELECT 1 FROM leaders WHERE lower(trim(name))=lower(trim(?)) AND lower(trim(coalesce(neighborhood,'')))=lower(trim(?))',(rec['name'],rec.get('neighborhood',''))).fetchone()
                        if exists: skipped+=1;continue
                        db.execute('INSERT INTO leaders(name,nickname,phone,region,neighborhood,activity,notes,electoral_zone,electoral_section,address) VALUES(?,?,?,?,?,?,?,?,?,?)',tuple(rec.get(k,'') for k in ('name','nickname','phone','region','neighborhood','activity','notes','electoral_zone','electoral_section','address')))
                        imported+=1
                    return self.send(200,{'ok':True,'imported':imported,'skipped':skipped})
                elif path=='/api/leaders/update':
                    lid=int(b['id']); name=clean(b.get('name'),150)
                    if not name:raise ValueError('Nome obrigatório')
                    fields=['name','nickname','phone','region','neighborhood','activity','notes','electoral_zone','electoral_section','address']
                    vals=[clean(b.get(k),4000 if k=='notes' else 250) for k in fields]
                    cur=db.execute("UPDATE leaders SET "+','.join(k+'=?' for k in fields)+" WHERE id=? AND archived=0",(*vals,lid))
                    if not cur.rowcount:raise ValueError('Liderança não encontrada')
                elif path=='/api/leaders/archive':
                    lid=int(b['id'])
                    cur=db.execute("UPDATE leaders SET archived=1 WHERE id=? AND archived=0",(lid,))
                    if not cur.rowcount:raise ValueError('Liderança não encontrada')
                elif path=='/api/contacts/update':
                    cid=int(b['id'])
                    name=clean(b.get('name'),150)
                    if not name:raise ValueError('Nome obrigatório')
                    lid=int(b['leader_id']) if str(b.get('leader_id') or '').strip() else None
                    if lid and not db.execute('SELECT id FROM leaders WHERE id=? AND archived=0',(lid,)).fetchone():
                        raise ValueError('Liderança não encontrada')
                    cur=db.execute('UPDATE contacts SET name=?,phone=?,neighborhood=?,notes=?,leader_id=? WHERE id=?',
                        (name,clean(b.get('phone'),70),clean(b.get('neighborhood'),120),clean(b.get('notes'),500),lid,cid))
                    if not cur.rowcount:raise ValueError('Contato não encontrado')
                elif path=='/api/contacts':
                    name=clean(b.get('name'),150)
                    if not name:raise ValueError('Nome obrigatório')
                    lid=int(b['leader_id']) if b.get('leader_id') else None
                    cur=db.execute("INSERT INTO contacts(name,phone,neighborhood,notes,leader_id) VALUES(?,?,?,?,?)",
                        (name,clean(b.get('phone'),70),clean(b.get('neighborhood'),120),clean(b.get('notes'),500),lid))
                elif path=='/api/contacts/import':
                    records=b.get('rows')
                    if not isinstance(records,list) or len(records)>1000:raise ValueError('Envie até 1.000 contatos por lote')
                    fixed=int(b['leader_id']) if b.get('leader_id') else None
                    imported=0;skipped=0
                    for rec in records:
                        if not isinstance(rec,dict):skipped+=1;continue
                        name=clean(rec.get('name'),150);phone=clean(rec.get('phone'),70)
                        neighborhood=clean(rec.get('neighborhood'),120)
                        if not name:skipped+=1;continue
                        lid=fixed if fixed else (int(rec['leader_id']) if str(rec.get('leader_id') or '').strip() else None)
                        if lid and not db.execute("SELECT 1 FROM leaders WHERE id=? AND archived=0",(lid,)).fetchone():
                            skipped+=1;continue
                        found=db.execute("""SELECT id FROM contacts WHERE lower(name)=lower(?) AND
                        coalesce(phone,'')=? AND coalesce(leader_id,0)=coalesce(?,0)""",(name,phone,lid)).fetchone()
                        if found:skipped+=1;continue
                        db.execute("INSERT INTO contacts(name,phone,neighborhood,notes,leader_id) VALUES(?,?,?,?,?)",
                            (name,phone,neighborhood,clean(rec.get('notes'),500),lid))
                        imported+=1
                    return self.send(200,{'imported':imported,'skipped':skipped})
                elif path=='/api/leaders':
                    name=clean(b.get('name'),150)
                    if not name:raise ValueError('Nome obrigatório')
                    cur=db.execute('INSERT INTO leaders(name,nickname,phone,region,neighborhood,activity,notes,electoral_zone,electoral_section,address) VALUES(?,?,?,?,?,?,?,?,?,?)',(name,clean(b.get('nickname'),100),clean(b.get('phone'),70),clean(b.get('region'),100),clean(b.get('neighborhood'),120),clean(b.get('activity'),120),clean(b.get('notes')),clean(b.get('electoral_zone'),20),clean(b.get('electoral_section'),20),clean(b.get('address'),250)))
                elif path=='/api/meetings':
                    cur=db.execute('INSERT INTO meetings(leader_id,meeting_date,kind,summary,next_action) VALUES(?,?,?,?,?)',(int(b['leader_id']),date_ok(b['meeting_date']),clean(b.get('kind'),60) or 'reunião',clean(b['summary']),clean(b.get('next_action'))))
                elif path=='/api/demands':
                    cur=db.execute('INSERT INTO demands(leader_id,opened_at,category,description,estimated_cost,due_date) VALUES(?,?,?,?,?,?)',(int(b['leader_id']),date_ok(b['opened_at']),clean(b['category'],100),clean(b['description']),real(b.get('estimated_cost')),date_ok(b['due_date']) if b.get('due_date') else None))
                elif path=='/api/demands/status':
                    st=clean(b.get('status'),20)
                    if st not in ['aberta','em andamento','atendida','recusada']:raise ValueError('Status inválido')
                    cur=db.execute('UPDATE demands SET status=?,resolution=?,resolved_at=?,actual_cost=? WHERE id=?',(st,clean(b.get('resolution')),(date.today().isoformat() if st in ('atendida','recusada') else None),real(b.get('actual_cost')),int(b['id'])))
                elif path=='/api/expenses':
                    lid=int(b['leader_id']) if b.get('leader_id') else None
                    cur=db.execute('INSERT INTO expenses(leader_id,expense_date,category,description,amount,receipt_ref,compliance_note) VALUES(?,?,?,?,?,?,?)',(lid,date_ok(b['expense_date']),clean(b['category'],100),clean(b['description']),real(b['amount']),clean(b.get('receipt_ref'),250),clean(b.get('compliance_note'))))
                elif path=='/api/expenses/review':
                    st=clean(b.get('review_status'),20)
                    if st not in ('pendente','conferido','reprovado'):
                        raise ValueError('Situação de conferência inválida')
                    cur=db.execute('UPDATE expenses SET review_status=? WHERE id=?',(st,int(b['id'])))
                    if not cur.rowcount: raise ValueError('Despesa não encontrada')
                elif path=='/api/elections/import':
                    raw=clean(b.get('csv'),MAX_BODY-100)
                    reader=csv.DictReader(io.StringIO(raw))
                    required={'election_year','round','office','municipality','zone','section','candidate','votes','source'}
                    if not reader.fieldnames or not required.issubset(reader.fieldnames):raise ValueError('Colunas obrigatórias ausentes: '+', '.join(sorted(required)))
                    n=0
                    for record in reader:
                        if n>=15000:raise ValueError('Importe até 15 mil linhas por lote')
                        def optfloat(v):return float(v) if str(v or '').strip() else None
                        db.execute('''INSERT INTO elections(election_year,round,office,municipality,neighborhood,zone,section,polling_place,candidate,votes,eligible,turnout,latitude,longitude,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(election_year,round,office,municipality,zone,section,candidate) DO UPDATE SET votes=excluded.votes,neighborhood=excluded.neighborhood,polling_place=excluded.polling_place,eligible=excluded.eligible,turnout=excluded.turnout,latitude=excluded.latitude,longitude=excluded.longitude,source=excluded.source''',(
                        int(record['election_year']),int(record['round']),clean(record['office'],100),clean(record['municipality'],150),clean(record.get('neighborhood'),120),clean(record['zone'],20),clean(record['section'],20),clean(record.get('polling_place'),200),clean(record['candidate'],150),int(record['votes']),int(record['eligible']) if record.get('eligible') else None,int(record['turnout']) if record.get('turnout') else None,optfloat(record.get('latitude')),optfloat(record.get('longitude')),clean(record['source'],300)))
                        n+=1
                    return self.send(200,{'ok':True,'imported':n})
                else:return self.send(404,{'error':'Rota não encontrada'})
                return self.send(201,{'ok':True,'id':cur.lastrowid,'affected':cur.rowcount})
        except (ValueError,KeyError,TypeError,sqlite3.IntegrityError) as e:return self.send(400,{'error':str(e)[:300]})
        except Exception as e:
            print('Server error:',repr(e),flush=True)
            return self.send(500,{'error':'Erro interno, consulte o terminal'})

def main():
    init()
    restore_official_elections()
    host=os.environ.get('POLITICDATA_HOST','0.0.0.0' if os.environ.get('RENDER') else '127.0.0.1');port=int(os.environ.get('PORT',os.environ.get('POLITICDATA_PORT','8765')))
    print(f'PoliticData disponível em http://{host}:{port}',flush=True)
    ThreadingHTTPServer((host,port),Handler).serve_forever()
if __name__=='__main__':main()
