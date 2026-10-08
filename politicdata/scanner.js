/* Scanner assistido: três blocos por página, OCR local, revisão e um cadastro independente por pessoa. */
async function enhanceScanner(){
 const host=document.querySelector('#scanCanvas');if(!host)return;
 const card=host.closest('.card');
 const panel=document.createElement('div');panel.className='card section';
 panel.innerHTML='<h3>Leitura assistida de três registros</h3>'+
 '<p class="muted mini">O reconhecimento automático usa OCR no navegador. Escrita manual pode não ser identificada corretamente; todos os campos exigem conferência. Ao salvar, a imagem e o texto lido ficam no banco local do servidor e cada pessoa conferida vira um cadastro independente no Eleitorado.</p>'+
 '<label>Número da página <input id="scanPageNumber" inputmode="numeric" placeholder="Ex.: 015" maxlength="12"></label>'+
 '<label>Distribuição dos registros <select id="scanLayout"><option value="vertical">Três blocos de cima para baixo</option><option value="horizontal">Três blocos lado a lado</option></select></label>'+
 '<div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap"><button id="scanRead" type="button" class="primary">Reconhecer escrita da página</button><button id="scanRegister" type="button" class="primary" disabled>Salvar página e cadastrar conferidos</button><button id="scanExport" type="button" class="outline" disabled>Exportar revisados (JSON)</button></div>'+
 '<div id="scanProgress" role="status" class="muted mini"></div><div id="scanReviews"></div>';
 card.insertAdjacentElement('afterend',panel);
 const $scan=id=>document.getElementById(id);
 let worker=null,results=[],saved=false;
 const fields=['Nome completo','CPF','Nome da mãe','Telefone','Endereço','Bairro','Escolaridade','Zona eleitoral','Seção eleitoral'];
 const names=['nome','cpf','mae','telefone','endereco','bairro','escolaridade','zona','secao'];
 function status(message){$scan('scanProgress').textContent=message}
 function safe(text){return String(text||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function parse(text){
  const data={};
  const patterns={
   nome:/\b(?:nome|name)\s*[:\-]\s*([^\n]+)/i,
   cpf:/\bcpf\s*[:\-]?\s*([\d.\-\s]{9,16})/i,
   mae:/\b(?:nome\s+da\s+m[aã]e|m[aã]e|filia[cç][aã]o)\s*[:\-]\s*([^\n]+)/i,
   telefone:/\b(?:telefone|celular|fone)\s*[:\-]\s*([^\n]+)/i,
   endereco:/\b(?:endere[cç]o|rua)\s*[:\-]\s*([^\n]+)/i,
   bairro:/\b(?:bairro)\s*[:\-]\s*([^\n]+)/i,
   escolaridade:/\b(?:escolaridade|grau de instru[cç][aã]o)\s*[:\-]\s*([^\n]+)/i,
   zona:/\b(?:zona(?:\s+eleitoral)?)\s*[:\-]\s*(\d{1,5})/i,
   secao:/\b(?:se[cç][aã]o(?:\s+eleitoral)?)\s*[:\-]\s*(\d{1,6})/i
  };
  for(const [key,re] of Object.entries(patterns)){data[key]=(text.match(re)||[])[1]?.trim()||''}
  return data;
 }
 function refresh(){
  $scan('scanExport').disabled=!results.length||results.some(x=>!x.reviewed);
  $scan('scanRegister').disabled=saved||!results.some(x=>(x.fields.nome||'').trim());
 }
 function personPayload(person){return {...person.fields,raw_text:person.raw,confidence:person.confidence,reviewed:person.reviewed}}
 function stateLine(person){
  const found=names.filter(k=>person.fields[k]).length,missing=names.length-found;
  return 'Estado da revisão: <b>'+(person.reviewed?'conferido':'pendente')+'</b> · Campos reconhecidos: '+found+' de '+names.length+(missing?' · ⚠ '+missing+' campo(s) ilegível(is) para conferir':'');
 }
 function render(){
  const root=$scan('scanReviews');
  root.innerHTML=results.map((p,i)=>'<div class="card section" data-review="'+i+'"><h4>Página '+safe(p.number)+' · Pessoa '+(i+1)+'</h4>'+
   '<p class="muted mini">'+stateLine(p)+'</p>'+
   '<p class="muted mini">Confiança da leitura: '+Math.round(p.confidence||0)+'%. Confira cada linha na fotografia.</p>'+
   '<div class="form-grid">'+names.map((k,j)=>'<label>'+fields[j]+(!p.fields[k]?' · ⚠':'')+'<input name="'+k+'" value="'+safe(p.fields[k])+'" autocomplete="off"></label>').join('')+'</div>'+
   '<details><summary>Texto original reconhecido (OCR)</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+safe(p.raw)+'</pre></details>'+
   '<label><input type="checkbox" name="reviewed" '+(p.reviewed?'checked':'')+'> Conferi os dados com a fotografia original</label></div>').join('');
  root.querySelectorAll('[data-review]').forEach(box=>{
   const i=Number(box.dataset.review),state=box.querySelector('p');
   box.querySelectorAll('input[name]:not([name=reviewed])').forEach(inp=>inp.oninput=()=>{
    results[i].fields[inp.name]=inp.value;results[i].reviewed=false;
    box.querySelector('input[name=reviewed]').checked=false;
    state.innerHTML=stateLine(results[i]);refresh();
   });
   box.querySelector('input[name=reviewed]').onchange=e=>{results[i].reviewed=e.target.checked;state.innerHTML=stateLine(results[i]);refresh()};
  });
  refresh();
 }
 function pageImage(){
  const maxSide=1600,ratio=Math.min(1,maxSide/Math.max(host.width,host.height));
  const shot=document.createElement('canvas');
  shot.width=Math.max(1,Math.round(host.width*ratio));shot.height=Math.max(1,Math.round(host.height*ratio));
  const ctx=shot.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,shot.width,shot.height);
  ctx.drawImage(host,0,0,shot.width,shot.height);
  return shot.toDataURL('image/jpeg',0.72);
 }
 async function loadOCR(){
  if(window.Tesseract)return window.Tesseract;
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(Error('Biblioteca de OCR indisponível. Verifique a conexão.'));document.head.appendChild(script);
  });
  return window.Tesseract;
 }
 $scan('scanRead').onclick=async()=>{
  if(!host.width||host.style.display==='none'){status('Fotografe ou selecione uma página primeiro.');return}
  const number=$scan('scanPageNumber').value.trim();if(!number){status('Informe o número da página antes de ler.');return}
  const button=$scan('scanRead');button.disabled=true;results=[];saved=false;
  try{
   const ocr=await loadOCR();status('Carregando modelo de reconhecimento em português...');
   if(!worker)worker=await ocr.createWorker('por');
   const direction=$scan('scanLayout').value;
   for(let i=0;i<3;i++){
    status('Lendo pessoa '+(i+1)+' de 3 na página '+number+'...');
    const fragment=document.createElement('canvas'),ctx=fragment.getContext('2d');
    const horizontal=direction==='horizontal';
    const sx=horizontal?Math.round(i*host.width/3):0,sy=horizontal?0:Math.round(i*host.height/3);
    const sw=horizontal?Math.round((i+1)*host.width/3)-sx:host.width;
    const sh=horizontal?host.height:Math.round((i+1)*host.height/3)-sy;
    fragment.width=sw;fragment.height=sh;
    ctx.drawImage(host,sx,sy,sw,sh,0,0,sw,sh);
    const rec=await worker.recognize(fragment);
    const raw=rec.data.text||'';
    results.push({number,position:i+1,fields:parse(raw),raw,confidence:rec.data.confidence||0,reviewed:false});
   }
   status('Leitura concluída. Revise os três registros. Campos não reconhecidos estão sinalizados.');
   render();
  }catch(e){status('Não foi possível reconhecer a escrita: '+e.message+'. Confira os dados manualmente.');results=Array.from({length:3},(_,i)=>({number,position:i+1,fields:{},raw:'',confidence:0,reviewed:false}));render()}
  finally{button.disabled=false}
 };
 $scan('scanRegister').onclick=async()=>{
  const number=$scan('scanPageNumber').value.trim();if(!number){status('Informe o número da página antes de salvar.');return}
  if(!results.length){status('Reconheça os três blocos antes de salvar a página.');return}
  $scan('scanRegister').disabled=true;
  try{
   const stored=await api('scans','POST',{page_number:number,layout:$scan('scanLayout').value,image:pageImage(),people:results.map(personPayload)});
   saved=true;render();
   status('Página '+number+' armazenada no servidor. '+stored.registered+' pessoa(s) cadastrada(s) no Eleitorado; '+stored.pending+' pendente(s) na aba Uploads recentes.');
  }catch(e){status('Não foi possível salvar a página: '+e.message+'.');refresh()}
 };
 $scan('scanExport').onclick=()=>{
  if(results.some(p=>!p.reviewed)){status('Confirme a revisão dos três registros.');return}
  const blob=new Blob([JSON.stringify({tipo:'revisao_administrativa',registros:results.map(({number,position,fields,confidence,reviewed,raw})=>({pagina:number,posicao:position,campos:fields,confianca:Math.round(confidence||0),revisao:reviewed?'conferido':'pendente',texto_original:raw}))},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pagina_'+results[0].number+'_revisada.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  status('Arquivo revisado baixado. As pessoas conferidas também podem ser cadastradas no Eleitorado pelo botão de salvar.');
 };
}
