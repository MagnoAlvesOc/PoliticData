"""PostgreSQL adapter for PoliticData's existing SQLite-style query interface."""
import re
import psycopg
from psycopg.rows import dict_row

def convert_sql(sql):
    sql=re.sub(r"CAST\(julianday\('now'\)-julianday\(MAX\(m\.meeting_date\)\) AS INTEGER\)",
               "CAST(CURRENT_DATE - NULLIF(MAX(m.meeting_date),'')::date AS INTEGER)",sql)
    sql=sql.replace("date('now','-30 days')","to_char(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD')")
    sql=sql.replace("date('now')","to_char(CURRENT_DATE,'YYYY-MM-DD')")
    return sql.replace('?', '%s')

class CompatibleRow(dict):
    def __getitem__(self,key):
        if isinstance(key,int):return list(self.values())[key]
        return super().__getitem__(key)

class PgResult:
    def __init__(self, cursor, inserted=False):
        self.cursor=cursor
        self.rowcount=cursor.rowcount
        self.lastrowid=None
        if inserted and cursor.description and cursor.description[0].name=='id':
            row=cursor.fetchone()
            if row:self.lastrowid=row['id']
    def fetchone(self):
        r=self.cursor.fetchone()
        return CompatibleRow(r) if r is not None else None
    def fetchall(self):return [CompatibleRow(r) for r in self.cursor.fetchall()]

class PgConnection:
    def __init__(self,url):
        self.conn=psycopg.connect(url,sslmode='require',row_factory=dict_row,connect_timeout=8)
    def __enter__(self):return self
    def __exit__(self,typ,val,tb):
        try:
            if typ:self.conn.rollback()
            else:self.conn.commit()
        finally:self.conn.close()
    def execute(self,sql,args=()):
        statement=convert_sql(sql)
        inserted=statement.lstrip().upper().startswith('INSERT INTO')
        if inserted and 'RETURNING' not in statement.upper():
            statement += ' RETURNING id'
        cursor=self.conn.execute(statement,args)
        return PgResult(cursor,inserted)
    def executescript(self,script):
        self.conn.execute(script)
