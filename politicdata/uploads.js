/* Uploads recentes: histórico das páginas digitalizadas e das pessoas cadastradas a partir delas. */
async function uploadsPage(){
 const pages=await api('scans');
 $('#content').innerHTML='<div class="notice">Histórico das páginas digitalizadas e guardadas no servidor local: número da página, imagem, texto lido, confiança e situação da revisão. Cada pessoa com nome vira um registro independente no Eleitorado.</div>'+
 '<div class="card"><h3>Páginas armazenadas ('+pages.length+')</h3>'+
 table(['Número da página','Enviada em','Pessoas','Cadastradas','Situação','Ações'],pages.map(p=>`<tr><td><b>${esc(p.page_number)}</b></td><td>${esc(String(p.created_at||'').replace('T',' ').slice(0,16))}</td><td>${p.people}</td><td>${p.registered}</td><td><span class="tag ${p.status==='conferido'?'attended':'rejected'}">${p.status==='conferido'?'Conferido':'Pendente'}</span></td><td><button class="outline" data-scan-open="${p.id}">Abrir página</button></td></tr>`))+'</div>'+
 '<div id="scanDetail"></div>';
 document.querySelectorAll('[data-scan-open]').forEach(x=>x.onclick=()=>openScanPage(Number(x.dataset.scan-open)));
}
async function openScanPage(id){
 const data=await api('scans/detail','POST',{id});
 const page=data.page,people=data.people||[];
 const labels=[['Nome completo','name'],['CPF','cpf'],['Nome da mãe','mother_name'],['Telefone','phone'],['Endereço','address'],['Bairro','neighborhood'],['Escolaridade','schooling'],['Zona eleitoral','electoral_zone'],['Seção eleitoral','electoral_section']];
 $('#scanDetail').innerHTML='<div class="card section"><h3>Página '+esc(page.page_number)+' · '+esc(String(page.created_at||'').replace('T',' ').slice(0,16))+'</h3>'+
 '<p class="muted mini">Situação da revisão: <b>'+(page.status==='conferido'?'conferido':'pendente')+'</b> · '+people.filter(p=>p.contact_id).length+' de '+people.length+' pessoa(s) cadastrada(s) no Eleitorado · Distribuição: '+esc(page.layout)+'</p>'+
 '<div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap"><button id="scanRegisterPending" type="button" class="primary"'+(people.some(p=>!p.contact_id)?'':' disabled')+'>Cadastrar pendentes no Eleitorado</button><button id="scanPageJson" type="button" class="outline">Exportar JSON da página</button></div>'+
 (page.image?'<details open><summary>Imagem da página</summary><div style="overflow:auto;max-height:60vh"><img src="'+page.image+'" alt="Página '+esc(page.page_number)+'" style="max-width:100%;border:1px solid #b7c8d9;border-radius:8px"></div></details>':'<p class="muted mini">Imagem não armazenada para esta página.</p>')+
 '</div>'+
 people.map(p=>'<div class="card section"><h4>Pessoa '+p.position+(p.contact_id?' · cadastro #'+p.contact_id+' no Eleitorado':' · pendente de cadastro')+'</h4>'+
 '<p class="muted mini">Estado da revisão: <b>'+(p.contact_id||p.reviewed?'conferido':'pendente')+'</b> · Confiança da leitura: '+Math.round(p.confidence||0)+'% · Campos reconhecidos: '+labels.filter(([,key])=>p[key]).length+' de '+labels.length+'</p>'+
 '<div class="form-grid">'+labels.map(([label,key])=>'<label>'+label+'<input value="'+esc(p[key]||'')+'" readonly></label>').join('')+'</div>'+
 '<details><summary>Texto original reconhecido (OCR)</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(p.raw_text||'')+'</pre></details></div>').join('');
 $('#scanRegisterPending').onclick=async()=>{
  try{const result=await api('scans/register','POST',{id:page.id});msg(result.registered+' cadastro(s) criado(s) no Eleitorado; '+result.pending+' ainda pendente(s)');await openScanPage(page.id)}catch(e){alert(e.message)}
 };
 $('#scanPageJson').onclick=()=>{
  const payload={tipo:'pagina_digitalizada',numero_da_pagina:page.page_number,distribuicao:page.layout,situacao_da_revisao:page.status,criada_em:page.created_at,
   pessoas:people.map(p=>({posicao:p.position,estado_da_revisao:p.contact_id?'conferido':'pendente',confianca_da_leitura:Math.round(p.confidence||0),
    campos_reconhecidos:{nome:p.name,cpf:p.cpf,nome_da_mae:p.mother_name,telefone:p.phone,endereco:p.address,bairro:p.neighborhood,escolaridade:p.schooling,zona_eleitoral:p.electoral_zone,secao_eleitoral:p.electoral_section},
    texto_original_reconhecido:p.raw_text,cadastro_no_eleitorado:p.contact_id}))};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='pagina_'+page.page_number+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 $('#scanDetail').scrollIntoView({behavior:'smooth',block:'start'});
}
