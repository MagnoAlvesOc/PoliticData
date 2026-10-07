let csrf='',page='dashboard',leaders=[],elections=[],mapInstance=null;
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('pt-BR');const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const today=()=>new Date().toISOString().slice(0,10);
async function api(url,method='GET',body){let r=await fetch('/api/'+url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});let d=await r.json();if(!r.ok)throw Error(d.error||'Erro');return d}
function msg(s){$('#message').textContent=s;setTimeout(()=>{if($('#message').textContent===s)$('#message').textContent=''},5000)}
function table(headers,data){if(!data.length)return '<div class="empty">Nenhum registro encontrado.</div>';return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>'+data.join('')+'</tbody></table></div>'}
function leaderOptions(){return '<option value="">Selecione a liderança</option>'+leaders.map(l=>`<option value="${l.id}">${esc(l.name)}${l.neighborhood?' — '+esc(l.neighborhood):''}</option>`).join('')}
function field(label,name,type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`}
function selectLeader(){return `<label>Liderança<select name="leader_id" required>${leaderOptions()}</select></label>`}
function form(title,items,id){return `<div class="card section"><h3>${title}</h3><form id="${id}" class="form-grid">${items}<div class="form-actions"><button class="primary" type="submit">Salvar registro</button></div></form></div>`}
async function loadLeaders(){leaders=await api('leaders')}
async function navigate(p){page=p;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));$('#pageTitle').textContent=({dashboard:'Visão geral',leaders:'Lideranças',meetings:'Diário de reuniões',demands:'Demandas e encaminhamentos',expenses:'Registros financeiros',elections:'Resultados eleitorais públicos',map:'Mapa geográfico dos resultados',import:'Importar dados',territory:'Distribuição administrativa',contacts:'Contatos administrativos'})[p];$('#sectionLabel').textContent='POLITICDATA / '+p.toUpperCase();$('#content').innerHTML='<div class="card">Carregando...</div>';mapInstance=null;try{await loadLeaders();await ({dashboard,leaders:leaderPage,meetings:meetingPage,demands:demandPage,expenses:expensePage,elections:electionPage,map:mapPage,import:importPage,territory:territoryPage,contacts:contactPage})[p]()}catch(e){$('#content').innerHTML=`<div class="card danger">Erro: ${esc(e.message)}</div>`}}
function attachForm(id,endpoint,convert){$('#'+id).addEventListener('submit',async ev=>{ev.preventDefault();let b=Object.fromEntries(new FormData(ev.target));try{await api(endpoint,'POST',convert?convert(b):b);msg('Registro salvo com sucesso');await navigate(page)}catch(e){alert(e.message)}})}
async function dashboard(){let d=await api('dashboard');let att=d.attention||[];$('#content').innerHTML=`<div class="cards">${[['Lideranças registradas',fmt(d.leaders)],['Demandas pendentes',fmt(d.open_demands)],['Demandas atendidas',fmt(d.resolved_demands)],['Despesas registradas',money(d.expenses)]].map(([a,b])=>`<div class="card kpi"><span>${a}</span><strong>${b}</strong></div>`).join('')}</div>${alertHTML(d.alerts)}<div class="twocol section"><div class="card"><h3>Acompanhamento de reuniões</h3><p class="muted mini">Ordenado pela reunião mais antiga; lideranças sem reuniões aparecem primeiro. Referência: 30 dias.</p>${table(['Liderança','Bairro','Último encontro','Situação'],att.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.neighborhood||'—')}</td><td>${esc(x.last_meeting||'Nunca')}</td><td><span class="tag ${x.days_since>30||x.days_since===null?'rejected':'attended'}">${x.days_since===null?'Sem reunião':x.days_since>30?'Revisar agenda':'Em dia'}</span></td></tr>`))}</div><div class="card"><h3>Demandas por situação</h3>${bars(d.demands_by_status.map(x=>[x.status,x.total]))}<h3 style="margin-top:30px">Despesas por categoria</h3>${bars(d.expense_by_category.map(x=>[x.category,x.total]),money)}</div></div><p class="muted mini section">Painel administrativo. Nenhum número representa voto individual ou compromisso de voto.</p>`}

function alertHTML(a={}){
 let old=a.old_meetings||[],late=a.overdue_demands||[],review=a.expenses_review||[];
 return `<div class="card section"><h3>Central de alertas administrativos</h3><div class="cards">${[['Reuniões há mais de 30 dias / inexistentes',old.length],['Demandas vencidas',late.length],['Despesas para conferência',review.length]].map(([title,n])=>`<div class="card kpi"><span>${esc(title)}</span><strong>${fmt(n)}</strong></div>`).join('')}</div>
 <h4>Contatos a revisar</h4>${table(['Liderança','Última reunião'],old.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.last_meeting||'Nunca')}</td></tr>`))}
 <h4>Demandas com prazo vencido</h4>${table(['Liderança','Demanda','Vencimento'],late.map(x=>`<tr><td>${esc(x.leader_name)}</td><td>${esc(x.description)}</td><td>${esc(x.due_date)}</td></tr>`))}
 <h4>Despesas sem conferência ou comprovante</h4>${table(['ID','Data','Categoria','Valor','Situação'],review.map(x=>`<tr><td>${x.id}</td><td>${esc(x.expense_date)}</td><td>${esc(x.category)}</td><td>${money(x.amount)}</td><td>${esc(x.review_status)}${!x.receipt_ref?' / sem comprovante':''}</td></tr>`))}</div>`;
}
function bars(rows,formatter=fmt){if(!rows.length)return '<p class="muted">Sem registros.</p>';let max=Math.max(...rows.map(x=>Number(x[1])),1);return `<div class="metric-bars">${rows.map(([name,value])=>`<div><div class="bar-label"><span>${esc(name)}</span><b>${formatter(value)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,Number(value)/max*100)}%"></div></div></div>`).join('')}</div>`}
async function leaderPage(){
 const cols=['Nome','Apelido','Telefone','Bairro','Zona','Seção','Atuação','Reuniões','Ações'];
 $('#content').innerHTML='<div class="notice">Cadastro administrativo. Para dados reais, configure primeiro banco persistente, backups e permissões.</div>'+
 '<div class="card"><h3>Lideranças cadastradas ('+leaders.length+')</h3>'+
 table(cols,leaders.map(l=>`<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.nickname)}</td><td>${esc(l.phone)}</td><td>${esc(l.neighborhood)}</td><td>${esc(l.electoral_zone)}</td><td>${esc(l.electoral_section)}</td><td>${esc(l.activity)}</td><td>${esc(l.last_meeting||'Nunca')}</td><td><button class="outline" data-profile="${l.id}">Ficha</button> <button class="outline" data-edit="${l.id}">Editar</button> <button class="outline" data-archive="${l.id}">Arquivar</button></td></tr>`))+'</div>'+
 '<div id="leaderDetails"></div>'+
 form('Adicionar liderança',leaderFields(),'leaderForm');
 attachForm('leaderForm','leaders');
 document.querySelectorAll('[data-profile]').forEach(x=>x.onclick=()=>openLeaderProfile(Number(x.dataset.profile)));
 document.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>editLeader(Number(x.dataset.edit)));
 document.querySelectorAll('[data-archive]').forEach(x=>x.onclick=async()=>{
   if(!confirm('Arquivar liderança? O histórico será preservado.'))return;
   try{await api('leaders/archive','POST',{id:Number(x.dataset.archive)});await navigate('leaders')}catch(e){alert(e.message)}
 });
}
function leaderFields(){
 return field('Nome','name','text','required maxlength="150"')+
 field('Apelido','nickname')+field('Telefone','phone')+field('Região','region')+
 field('Bairro','neighborhood')+field('Zona eleitoral','electoral_zone')+
 field('Seção eleitoral','electoral_section')+field('Endereço administrativo','address')+
 field('Atuação','activity')+
 '<label class="wide">Observações<textarea name="notes"></textarea></label>';
}
function editLeader(id){
 const l=leaders.find(x=>x.id===id);if(!l)return;
 const area=$('#leaderDetails');
 area.innerHTML=form('Editar liderança: '+esc(l.name),leaderFields(),'editLeaderForm');
 const f=$('#editLeaderForm');
 for(const [key,value] of Object.entries(l)){const el=f.elements.namedItem(key);if(el&&'value' in el)el.value=value??''}
 f.onsubmit=async e=>{e.preventDefault();try{await api('leaders/update','POST',{...Object.fromEntries(new FormData(f)),id});msg('Liderança atualizada');await navigate('leaders')}catch(err){alert(err.message)}};
 area.scrollIntoView({behavior:'smooth',block:'start'});
}
async function openLeaderProfile(id){
 const l=leaders.find(x=>x.id===id);if(!l)return;
 const [meetings,demands,expenses,contacts]=await Promise.all([api('meetings'),api('demands'),api('expenses'),api('contacts')]);
 const m=meetings.filter(x=>x.leader_id===id),d=demands.filter(x=>x.leader_id===id),ex=expenses.filter(x=>x.leader_id===id),c=contacts.filter(x=>x.leader_id===id);
 $('#leaderDetails').innerHTML=`<div class="card section"><h3>Ficha: ${esc(l.name)}</h3><p><b>Bairro:</b> ${esc(l.neighborhood)} · <b>Zona:</b> ${esc(l.electoral_zone)} · <b>Seção:</b> ${esc(l.electoral_section)}</p><p><b>Contato:</b> ${esc(l.phone)} · <b>Atuação:</b> ${esc(l.activity)}</p><p><b>Endereço administrativo:</b> ${esc(l.address||'—')}</p><p>${esc(l.notes)}</p><h4>Diário / atas</h4>${table(['Data','Tipo','Resumo','Próxima ação'],m.map(x=>`<tr><td>${esc(x.meeting_date)}</td><td>${esc(x.kind)}</td><td>${esc(x.summary)}</td><td>${esc(x.next_action)}</td></tr>`))}<h4>Demandas</h4>${table(['Abertura','Descrição','Situação','Prazo'],d.map(x=>`<tr><td>${esc(x.opened_at)}</td><td>${esc(x.description)}</td><td>${esc(x.status)}</td><td>${esc(x.due_date)}</td></tr>`))}<h4>Despesas registradas</h4>${table(['Data','Finalidade','Valor'],ex.map(x=>`<tr><td>${esc(x.expense_date)}</td><td>${esc(x.description)}</td><td>${money(x.amount)}</td></tr>`))}<h4>Contatos administrativos vinculados</h4><p>${fmt(c.length)} registros</p></div>`;
 $('#leaderDetails').scrollIntoView({behavior:'smooth',block:'start'});
}
async function meetingPage(){let data=await api('meetings');$('#content').innerHTML=`<div class="card"><h3>Histórico e atas</h3>${table(['Data','Liderança','Tipo','Resumo','Próxima ação'],data.map(x=>`<tr><td>${esc(x.meeting_date)}</td><td><b>${esc(x.leader_name)}</b></td><td>${esc(x.kind)}</td><td>${esc(x.summary)}</td><td>${esc(x.next_action)}</td></tr>`))}</div>`+form('Novo registro no diário',selectLeader()+field('Data','meeting_date','date',`value="${today()}" required`)+`<label>Tipo<select name="kind"><option>reunião</option><option>telefonema</option><option>visita</option><option>contato digital</option></select></label>`+`<label class="wide">Resumo / ata<textarea name="summary" required></textarea></label><label class="wide">Próxima ação<textarea name="next_action"></textarea></label>`,'meetingForm');attachForm('meetingForm','meetings')}
async function demandPage(){let data=await api('demands');$('#content').innerHTML=`<div class="card"><h3>Demandas registradas</h3>${table(['Abertura','Liderança','Descrição','Categoria','Status','Estimativa','Prazo','Atualizar'],data.map(x=>`<tr><td>${esc(x.opened_at)}</td><td>${esc(x.leader_name)}</td><td><b>${esc(x.description)}</b><div class="muted mini">${esc(x.resolution)}</div></td><td>${esc(x.category)}</td><td><span class="tag ${x.status==='atendida'?'attended':x.status==='recusada'?'rejected':''}">${esc(x.status)}</span></td><td>${money(x.estimated_cost)}</td><td>${esc(x.due_date||'—')}</td><td><button class="outline" data-demand="${x.id}">Alterar</button></td></tr>`))}</div>`+form('Nova demanda',selectLeader()+field('Data de abertura','opened_at','date',`value="${today()}" required`)+`<label>Categoria<select name="category"><option>Infraestrutura</option><option>Atendimento institucional</option><option>Encaminhamento</option><option>Evento</option><option>Solicitação administrativa</option><option>Outra</option></select></label>`+field('Estimativa de custo (R$)','estimated_cost','number','min="0" step="0.01" value="0"')+field('Prazo de atendimento','due_date','date')+'<label class="wide">Descrição e justificativa<textarea name="description" required></textarea></label>','demandForm')+`<div id="statusBox"></div>`;attachForm('demandForm','demands');document.querySelectorAll('[data-demand]').forEach(btn=>btn.onclick=()=>{let d=data.find(v=>v.id===+btn.dataset.demand);$('#statusBox').innerHTML=form('Atualizar demanda #'+d.id,`<input type="hidden" name="id" value="${d.id}"><label>Situação<select name="status">${['aberta','em andamento','atendida','recusada'].map(s=>`<option ${s===d.status?'selected':''}>${s}</option>`).join('')}</select></label>`+field('Custo efetivo (R$)','actual_cost','number',`min="0" step="0.01" value="${d.actual_cost}"`)+`<label class="wide">Motivo / desfecho<textarea name="resolution">${esc(d.resolution)}</textarea></label>`,'statusForm');attachForm('statusForm','demands/status');$('#statusBox').scrollIntoView({behavior:'smooth'})})}
async function expensePage(){let data=await api('expenses');$('#content').innerHTML=`<div class="notice">Use somente para registrar despesas lícitas e documentadas. Este módulo não autoriza benefícios em troca de votos e não realiza cruzamento entre despesas e preferências eleitorais.</div><div class="card"><h3>Livro de despesas</h3>${table(['Data','Referência administrativa','Categoria','Descrição','Valor','Comprovante','Conferência'],data.map(x=>`<tr><td>${esc(x.expense_date)}</td><td>${esc(x.leader_name||'Geral')}</td><td>${esc(x.category)}</td><td>${esc(x.description)}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.receipt_ref)}</td><td><select data-review="${x.id}"><option value="pendente" ${x.review_status==='pendente'?'selected':''}>Pendente</option><option value="conferido" ${x.review_status==='conferido'?'selected':''}>Conferido</option><option value="reprovado" ${x.review_status==='reprovado'?'selected':''}>Reprovado</option></select></td></tr>`))}</div>`+form('Novo registro financeiro',`<label>Liderança de referência (opcional)<select name="leader_id"><option value="">Despesa geral</option>${leaderOptions().replace('<option value="">Selecione a liderança</option>','')}</select></label>`+field('Data','expense_date','date',`required value="${today()}"`)+`<label>Categoria<select name="category"><option>Operacional</option><option>Deslocamento</option><option>Material</option><option>Evento</option><option>Serviço contratado</option><option>Outra</option></select></label>`+field('Valor R$','amount','number','min="0" step="0.01" required')+field('Referência do comprovante','receipt_ref')+`<label class="wide">Descrição e finalidade<textarea name="description" required></textarea></label><label class="wide">Conformidade / autorização<textarea name="compliance_note" placeholder="Origem dos recursos e justificativa"></textarea></label>`,'expenseForm');attachForm('expenseForm','expenses');document.querySelectorAll('[data-review]').forEach(el=>el.onchange=async()=>{try{await api('expenses/review','POST',{id:Number(el.dataset.review),review_status:el.value});msg('Conferência atualizada');await navigate('expenses')}catch(e){alert(e.message)}})}
async function getElectionData(){elections=await api('elections');return elections}
function unique(a){return [...new Set(a)].sort((x,y)=>String(x).localeCompare(String(y),'pt-BR',{numeric:true}))}
function filteredElection(){
  const z=$('#f_zone'), sec=$('#f_section');
  if(z&&sec){
    const permitted=unique(elections.filter(x=>
      (!$('#f_election_year')?.value||String(x.election_year??'')===$('#f_election_year').value)&&
      (!$('#f_municipality')?.value||String(x.municipality??'')===$('#f_municipality').value)&&
      (!z.value||String(x.zone??'')===z.value)
    ).map(x=>String(x.section??'')).filter(Boolean)).sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
    const before=sec.value;
    const signature=permitted.join('|');
    if(sec.dataset.available!==signature){
      sec.innerHTML='<option value="">Todas</option>'+permitted.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
      sec.dataset.available=signature;
      sec.value=permitted.includes(before)?before:'';
    }
  }
  return elections.filter(x=>['election_year','candidate','municipality','zone','section','neighborhood'].every(k=>!$('#f_'+k)?.value||String(x[k]??'')===$('#f_'+k).value));
}
function filterUI(){return `<div class="filters">${[['election_year','Ano'],['candidate','Candidato'],['municipality','Município'],['zone','Zona'],['section','Seção'],['neighborhood','Bairro']].map(([key,label])=>`<label>${label}<select id="f_${key}"><option value="">Todos</option>${unique(elections.map(r=>String(r[key]??'')).filter(Boolean)).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>`).join('')}</div>`}
function electionStats(records){let votes=records.reduce((s,x)=>s+Number(x.votes),0);let groups={};records.forEach(x=>{let k=(x.municipality||'')+' · Zona '+(x.zone||'') ;groups[k]=(groups[k]||0)+Number(x.votes)});return `<div class="cards section"><div class="card kpi"><span>Votos históricos (seleção)</span><strong>${fmt(votes)}</strong></div><div class="card kpi"><span>Registros de seções</span><strong>${fmt(records.length)}</strong></div><div class="card kpi"><span>Municípios</span><strong>${fmt(unique(records.map(x=>x.municipality)).length)}</strong></div><div class="card kpi"><span>Zonas eleitorais</span><strong>${fmt(unique(records.map(x=>x.zone)).length)}</strong></div></div><div class="card section"><h3>Resultados por município e zona</h3>${bars(Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,25))}</div>`}
async function electionPage(){await getElectionData();$('#content').innerHTML=`<div class="notice">Resultados históricos agregados conforme CSV importado. Filtros são independentes dos cadastros pessoais. O sistema não calcula votos prometidos ou garantidos.</div><div class="card"><h3>Filtros dos resultados</h3>${filterUI()}</div><div id="electionBody"></div>`;let refresh=()=>$('#electionBody').innerHTML=electionStats(filteredElection());document.querySelectorAll('.filters select').forEach(s=>s.addEventListener('change',refresh));refresh()}
const BAIRROS_KEY='politicdata_bairros_geojson_v1';
function loadBairrosGeojson(){
 try{const x=JSON.parse(localStorage.getItem(BAIRROS_KEY)||'null');return x?.type==='FeatureCollection'&&Array.isArray(x.features)?x:null}catch(e){return null}
}
function namesBairro(p){return String(p.NOME||p.nome||p.NM_BAIRRO||p.nm_bairro||p.bairro||p.BAIRRO||p.name||(p.CD_SETOR?'Setor censitário '+p.CD_SETOR:'Área sem identificação'))}
function initBairrosLayer(map){
 const box=document.createElement('div');box.className='card section';box.innerHTML='<h3>Limites geográficos</h3><p class="muted mini">Importe polígonos GeoJSON de bairros ou setores censitários. Setores IBGE não são bairros, zonas nem seções eleitorais.</p><label>Malha geográfica GeoJSON <input id="bairrosGeojson" type="file" accept=".geojson,.json,application/geo+json"></label><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px"><label><input type="checkbox" id="bairrosVisible" checked> Mostrar contornos e nomes</label><button id="bairrosClear" class="outline" type="button">Remover malha</button></div><div id="bairrosStatus" class="muted mini" role="status"></div>';
 document.querySelector('#map').parentElement.insertAdjacentElement('beforebegin',box);
 let layer=null;
 const msg=document.querySelector('#bairrosStatus');
 function draw(){
   if(layer){map.removeLayer(layer);layer=null}
   const data=loadBairrosGeojson();
   if(!data){msg.textContent='Nenhuma malha carregada. O mapa continua mostrando os resultados eleitorais normalmente.';return}
   const valid=data.features.filter(f=>f&&f.type==='Feature'&&['Polygon','MultiPolygon'].includes(f.geometry?.type));
   if(!valid.length){msg.textContent='Arquivo sem polígonos válidos.';return}
   layer=L.geoJSON({type:'FeatureCollection',features:valid},{
     style:{color:'#133f68',weight:2.5,opacity:0.95,fillOpacity:0.035,fillColor:'#37a5e5'},
     onEachFeature:(f,l)=>{
       const name=namesBairro(f.properties||{});
       l.bindPopup(document.createElement('strong').appendChild(document.createTextNode(name)).parentNode);
       if(l.getBounds&&!f.properties?.CD_SETOR){
         const point=l.getBounds().getCenter();
         const label=L.marker(point,{interactive:false,icon:L.divIcon({className:'bairro-label',html:'<span>'+esc(name)+'</span>',iconSize:[130,20],iconAnchor:[65,10]})});
         labels.push(label);
       }
     }
   });
   const labelsLayer=L.layerGroup(labels);layer.addTo(map); if(document.querySelector('#bairrosVisible').checked)labelsLayer.addTo(map);
   layer._labels=labelsLayer;
   msg.textContent=valid.length+' polígonos carregados ('+(valid[0]?.properties?.CD_SETOR?'setores censitários IBGE; não são limites de bairros':'malha territorial')+').';
 }
 let labels=[];
 const originalDraw=draw;
 draw=function(){labels=[];originalDraw()};
 document.querySelector('#bairrosVisible').addEventListener('change',e=>{if(!layer)return;if(e.target.checked){layer.addTo(map);layer._labels?.addTo(map)}else{map.removeLayer(layer);if(layer._labels)map.removeLayer(layer._labels)}});
 document.querySelector('#bairrosClear').onclick=()=>{localStorage.removeItem(BAIRROS_KEY);draw()};
 document.querySelector('#bairrosGeojson').onchange=async e=>{
   try{
     const file=e.target.files?.[0];if(!file)return;
     if(file.size>5000000)throw Error('O GeoJSON deve ter até 5 MB');
     const data=JSON.parse(await file.text());
     if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||!data.features.some(f=>['Polygon','MultiPolygon'].includes(f?.geometry?.type)))throw Error('Envie um GeoJSON FeatureCollection com polígonos');
     localStorage.setItem(BAIRROS_KEY,JSON.stringify(data));document.querySelector('#bairrosVisible').checked=true;draw();
   }catch(err){msg.textContent='Não foi possível carregar: '+err.message}
 };
 draw();
 fetch('/setores-ibge.geojson',{cache:'no-cache'}).then(async response=>{
   if(!response.ok)return null;
   const data=await response.json();
   if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))return null;
   return data;
 }).then(data=>{
   if(!data)return;
   try{localStorage.setItem(BAIRROS_KEY,JSON.stringify(data))}catch(e){}
   draw();
   msg.textContent+=' · Carregada automaticamente do repositório.';
 }).catch(err=>{console.warn('Malha oficial indisponível',err)});
}
async function mapPage(){await getElectionData();$('#content').innerHTML=`<div class="notice">O mapa usa apenas coordenadas que você incluiu no CSV de resultados públicos. A intensidade representa a soma de votos históricos dos registros selecionados, não votos futuros.</div><div class="card"><h3>Filtro territorial</h3>${filterUI()}</div><div class="card section"><div id="map"></div><p class="muted mini">Mapa de intensidade dos resultados agregados por local de votação. Requer internet para carregar os mapas do OpenStreetMap e a biblioteca Leaflet.</p></div><div id="mapStats" class="section"></div>`;if(typeof L==='undefined'){$('#map').innerHTML='Biblioteca de mapas indisponível. Verifique sua conexão.';return}mapInstance=L.map('map').setView([-2.53,-44.30],11);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(mapInstance);let layer=L.layerGroup().addTo(mapInstance);initBairrosLayer(mapInstance);function draw(){layer.clearLayers();let data=filteredElection();let points=new Map;data.forEach(x=>{if(x.latitude===null||x.longitude===null)return;let lat=Number(x.latitude),lon=Number(x.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;let key=lat.toFixed(5)+';'+lon.toFixed(5);let obj=points.get(key)||{lat,lon,votes:0,names:new Set};obj.votes+=Number(x.votes);obj.names.add(x.polling_place||x.municipality);points.set(key,obj)});let vals=[...points.values()],max=Math.max(1,...vals.map(x=>x.votes));vals.forEach(x=>{let scale=x.votes/max;L.circleMarker([x.lat,x.lon],{radius:7+20*Math.sqrt(scale),fillColor:scale>.65?'#b91c1c':scale>.3?'#ea580c':'#f59e0b',color:'#fff',weight:1,fillOpacity:.25+.55*scale}).bindPopup(`<b>${esc([...x.names].join(', '))}</b><br>Votos históricos: ${fmt(x.votes)}`).addTo(layer)});if(vals.length)mapInstance.fitBounds(L.latLngBounds(vals.map(x=>[x.lat,x.lon])).pad(.25));$('#mapStats').innerHTML=`<div class="card"><b>${fmt(vals.length)}</b> locais georreferenciados · <b>${fmt(data.reduce((s,x)=>s+Number(x.votes),0))}</b> votos históricos no filtro</div>`}document.querySelectorAll('.filters select').forEach(s=>s.addEventListener('change',draw));draw();setTimeout(()=>mapInstance.invalidateSize(),200)}

async function territoryPage(){let data=await api('leader-summary');$('#content').innerHTML=`<div class="notice">Distribuição administrativa de lideranças por bairro. Não representa intenção de voto, número de eleitores ou projeção eleitoral.</div><div class="cards"><div class="card kpi"><span>Lideranças registradas</span><strong>${fmt(data.reduce((s,x)=>s+Number(x.total),0))}</strong></div><div class="card kpi"><span>Bairros informados</span><strong>${fmt(data.filter(x=>x.neighborhood!=='Não informado').length)}</strong></div></div><div class="card section"><h3>Quantidade de lideranças por bairro</h3>${bars(data.map(x=>[x.neighborhood,Number(x.total)]))}</div><div class="card section"><h3>Tabela de distribuição</h3>${table(['Bairro','Quantidade'],data.map(x=>`<tr><td>${esc(x.neighborhood)}</td><td>${fmt(x.total)}</td></tr>`))}</div>`}
function normalizeColumn(key){return String(key||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[_-]/g,' ')}
async function readSpreadsheet(file){
 if(/\.xlsx?$/i.test(file.name)){
   if(typeof XLSX==='undefined')throw Error('Biblioteca Excel indisponível. Use CSV ou recarregue a página.');
   const book=XLSX.read(await file.arrayBuffer(),{type:'array',raw:false});
   return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:'',raw:false});
 }
 const raw=await file.text();
 const delimiter=(raw.split('\n')[0].match(/;/g)||[]).length>(raw.split('\n')[0].match(/,/g)||[]).length?';':',';
 if(typeof XLSX!=='undefined'){
   const book=XLSX.read(raw,{type:'string',FS:delimiter,raw:false});
   return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:'',raw:false});
 }
 throw Error('Biblioteca de planilhas não carregada');
}
function transformRows(rows){
 const aliases={nome:'name',name:'name',telefone:'phone',celular:'phone',phone:'phone',bairro:'neighborhood',neighborhood:'neighborhood',observacoes:'notes',observacao:'notes',notes:'notes','id lideranca':'leader_id','lideranca id':'leader_id',leader_id:'leader_id'};
 return rows.map(r=>{let item={};for(const [k,v] of Object.entries(r)){let col=aliases[normalizeColumn(k)];if(col)item[col]=String(v??'').trim()}return item});
}
async function contactPage(){
 let records=await api('contacts');
 const options='<option value="">Sem vínculo</option>'+leaders.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');
 $('#content').innerHTML='<div class="notice">Diretório de contatos para fins administrativos e atendimento, com vínculo opcional à liderança. Não registre intenção de voto, promessas eleitorais ou perfis políticos.</div>'+
 '<div class="card"><h3>Contatos administrativos ('+records.length+')</h3>'+table(['Nome','Telefone','Bairro','Liderança'],records.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.neighborhood)}</td><td>${esc(c.leader_name||'Sem vínculo')}</td></tr>`))+'</div>'+
 form('Novo contato',field('Nome','name','text','required')+field('Telefone','phone')+field('Bairro','neighborhood')+`<label>Liderança responsável (opcional)<select name="leader_id">${options}</select></label>`+'<label class="wide">Observações administrativas<textarea name="notes"></textarea></label>','contactForm')+
 `<div class="card section"><h3>Importar contatos em Excel ou CSV</h3><p class="muted">Colunas: Nome, Telefone, Bairro, Observações e opcionalmente ID Liderança. A seleção abaixo substitui a liderança indicada nas linhas. Se vazia, cada linha pode indicar um ID ou ficar sem vínculo.</p><label>Arquivo Excel / CSV<input id="contactFile" type="file" accept=".xlsx,.xls,.csv"></label><label>Liderança para todo o arquivo (opcional)<select id="contactOwner">${options}</select></label><button class="primary" id="contactUpload">Importar contatos</button><div id="contactImportResult" role="status"></div></div>`;
 attachForm('contactForm','contacts');
 $('#contactUpload').onclick=async()=>{
  const file=$('#contactFile').files[0];if(!file)return alert('Escolha um arquivo');
  try{
   let parsed=transformRows(await readSpreadsheet(file));
   if(!parsed.length)throw Error('Nenhuma linha encontrada');
   if(parsed.length>10000)throw Error('Máximo de 10 mil linhas por arquivo');
   let total=0,skipped=0;
   for(let i=0;i<parsed.length;i+=500){
    let res=await api('contacts/import','POST',{rows:parsed.slice(i,i+500),leader_id:$('#contactOwner').value});
    total+=res.imported;skipped+=res.skipped;
   }
   $('#contactImportResult').textContent=total+' importados; '+skipped+' ignorados.';
   await loadLeaders();
  }catch(e){$('#contactImportResult').textContent='Falha: '+e.message}
 };
}
function importLeadersUI(){return `<div class="card section"><h3>Importar lideranças administrativas (CSV)</h3><p>Crie uma cópia da planilha contendo somente: <code>Nome, Apelido, Telefone, Bairro, Região, Zona, Seção, Endereço, Atuação, Observações</code>. Não inclua dados de eleitores, CPF, nome da mãe nem campos de votos previstos/fixos. Informe endereço da liderança somente quando necessário para sua gestão administrativa.</p><p>O importador aceita CSV separado por vírgula ou ponto e vírgula, com cabeçalhos em português. Registros com o mesmo nome e bairro são ignorados.</p><label>Arquivo CSV<input id="leadersCSV" type="file" accept=".csv,text/csv"></label><p><button class="primary" id="uploadLeaders">Importar lideranças</button></p><div id="leaderImportResult" role="status"></div></div>`}
function importPage(){$('#content').innerHTML=importLeadersUI()+`<div class="notice">Importe um CSV previamente preparado a partir de dados oficiais. O aplicativo não baixa nem geocodifica automaticamente dados do TSE nesta versão. Os campos latitude e longitude são opcionais, mas necessários para mostrar pontos no mapa.</div><div class="card"><h3>Importar arquivo CSV</h3><p>Colunas obrigatórias: <code>election_year,round,office,municipality,zone,section,candidate,votes,source</code>.</p><p>Opcionais: <code>neighborhood,polling_place,eligible,turnout,latitude,longitude</code>.</p><p class="muted mini">Máximo de 15.000 linhas por importação e até 5 MB de conteúdo. Codificação UTF-8 e separador vírgula.</p><label>Arquivo CSV<input id="csvFile" type="file" accept=".csv,text/csv"></label><p><button class="primary" id="upload">Validar e importar</button></p><div id="importResult"></div></div><div class="card section"><h3>Modelo de CSV</h3><pre style="white-space:pre-wrap;word-break:break-word">election_year,round,office,municipality,neighborhood,zone,section,polling_place,candidate,votes,source,latitude,longitude\n2024,1,Vereador,Municipio Exemplo,Bairro Exemplo,001,0001,Escola Exemplo,Candidato Exemplo,100,TSE (exemplo),-2.53,-44.30</pre><p class="muted mini">A linha é fictícia: serve somente para demonstrar o formato e não deve ser usada em relatórios reais.</p></div>`;$('#uploadLeaders').onclick=async()=>{let file=$('#leadersCSV').files[0];if(!file)return alert('Selecione o CSV de lideranças');try{let result=await api('leaders/import','POST',{csv:await file.text()});$('#leaderImportResult').textContent=`${result.imported} lideranças importadas; ${result.skipped} ignoradas.`;await loadLeaders()}catch(e){$('#leaderImportResult').textContent='Falha: '+e.message}};$('#upload').onclick=async()=>{let file=$('#csvFile').files[0];if(!file)return alert('Selecione um CSV');try{let result=await api('elections/import','POST',{csv:await file.text()});$('#importResult').textContent=`${result.imported} linhas importadas com sucesso.`}catch(e){$('#importResult').textContent='Falha: '+e.message}}}
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{let b=Object.fromEntries(new FormData(e.target));let x=await api('login','POST',b);csrf=x.csrf;$('#auth').hidden=true;$('#app').hidden=false;$('#user').textContent=b.username;await navigate('dashboard')}catch(ex){$('#loginError').textContent=ex.message}};
$('#logout').onclick=async()=>{await api('logout','POST',{});location.reload()};document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
(async()=>{try{let x=await api('session');if(x.logged_in){csrf=x.csrf;$('#auth').hidden=true;$('#app').hidden=false;$('#user').textContent=x.username;await navigate('dashboard')}}catch(e){console.error(e)}})();
