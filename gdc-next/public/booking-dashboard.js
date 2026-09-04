
const ICONS={
  doc:'<path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8 13h8M8 17h6"/>',
  money:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
  music:'<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M8.5 18V5l12-2v11"/>',
  receipt:'<path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
};
function svg(k){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[k]||ICONS.doc)+'</svg>';}
const CHECK='<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
const CHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const DOWNCHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const FLYER='<div class="flyer"><span class="p">+</span><span class="l">FLYER</span></div>';

const DEP='$600';
function capColor(cls,cap){ if(cls==='done')return 'var(--neon)'; if(cls==='skipped')return '#f2f2f7'; if(/^not sent$/i.test(cap||''))return '#ff6b6b'; return 'var(--gold)'; }

function stContract(){return{icon:'doc',state:'notsent',S:{
  notsent:{cap:'Not sent',cls:'waiting',actions:[{label:'Review & send contract',to:'notsent'}]},
  pending:{cap:'Pending',cls:'waiting',info:'Sent — waiting on the client to sign.',actions:[
    {label:'Resend contract',to:'pending'},{label:'🔗 Copy link to contract',to:'pending'},
    {label:'Cancel contract',to:'notsent',cls:'danger'},{label:'✓ Mark Complete',to:'done'}]},
  done:{cap:'Complete',cls:'done',actions:[
    {label:'⬇ Download Contract',to:'done'},{label:'⬇ Download Audit Log',to:'done'},
    {label:'✕ Mark Not Complete',to:'notsent',cls:'danger'}]},
}};}
function stDeposit(){return{icon:'money',state:'notsent',S:{
  notsent:{cap:'Not sent',cls:'waiting',actions:[
    {label:'Request deposit',to:'requested'},{label:'Skip deposit',to:'skipped',cls:'muted'},
    {label:'Payment options',to:'notsent',cls:'muted'},{label:'✓ Mark Complete',to:'done'}]},
  requested:{cap:'$0/'+DEP,cls:'waiting',info:'$0 of '+DEP+' received',actions:[
    {label:'Cancel request',to:'notsent',cls:'danger'},{label:'✓ Mark Complete',to:'done'}]},
  done:{cap:'Complete',cls:'done',info:'Deposit Received.',actions:[
    {label:'✕ Mark Not Complete',to:'notsent',cls:'danger'}]},
  skipped:{cap:'Skipped',cls:'skipped',info:'Going straight to the balance — no deposit collected.',actions:[
    {label:'Undo skip',to:'notsent',cls:'muted'}]},
}};}
function stPlanner(){return{icon:'music',state:'notsent',S:{
  notsent:{cap:'Not sent',cls:'waiting',actions:[
    {label:'Select – Send Planner/Playlist',to:'sent'},{label:'✓ Mark Complete',to:'done'}]},
  sent:{cap:'60%',cls:'waiting',info:'60% complete',actions:[
    {label:'Open Planner & Playlist',to:'sent'},{label:'Download Planner & Playlist',to:'sent'},
    {label:'Copy link',to:'sent'},{label:'Send reminder email',to:'sent'},{label:'✓ Mark Complete',to:'done'}]},
  done:{cap:'100%',cls:'done',actions:[
    {label:'Open Planner & Playlist',to:'done'},{label:'Download Planner & Playlist',to:'done'},
    {label:'✕ Mark Not Complete',to:'notsent',cls:'danger'}]},
}};}
function stRider(){return{icon:'music',state:'notsent',S:{
  notsent:{cap:'Not sent',cls:'waiting',actions:[
    {label:'Send "Club Standard"',to:'sent'},{label:'Rider Portal',to:'sent'}]},
  sent:{cap:'Sent',cls:'done',info:'Rider Sent To The Host.',actions:[
    {label:'Rider Portal',to:'sent'},{label:'Resend Rider',to:'sent'}]},
}};}
function stInvoice(){return{icon:'receipt',state:'locked',S:{
  locked:{cap:'',cls:'locked',hint:'Collect the deposit first — the balance receipt reacts to it.',actions:[]},
  notsent:{cap:'Not sent',cls:'waiting',actions:[
    {label:'Request balance',to:'requested'},{label:'Payment options',to:'notsent',cls:'muted'},
    {label:'✓ Mark Complete',to:'done'}]},
  requested:{cap:'Pending',cls:'waiting',info:'Balance sent — waiting on payment.',actions:[
    {label:'Cancel request',to:'notsent',cls:'danger'},{label:'✓ Mark Complete',to:'done'}]},
  done:{cap:'',cls:'done',actions:[
    {label:'Resend Receipt',to:'done'},{label:'Download Receipt',to:'done'}]},
}};}
function stGuest(){return{icon:'doc',state:'notsent',S:{
  notsent:{cap:'Not sent',cls:'waiting',actions:[{label:'Open Guest List',to:'sent'}]},
  sent:{cap:'Sent',cls:'done',info:'Guest list started & shared with the host.',actions:[
    {label:'Open Guest List',to:'sent'}]},
}};}

const HEADS={contract:'Contract',deposit:'Deposit',invoice:'Balance',guestlist:'Guest List'};
function headFor(k,type){ if(k==='song_list')return type==='club'?'Rider':'Planner & Playlist'; return HEADS[k]; }
function shortLabel(k,type){ if(k==='song_list')return type==='club'?'Rider':'Playlist'; if(k==='invoice')return 'Balance'; if(k==='guestlist')return 'Guests'; return HEADS[k]; }

function mkBooking(type,label,date,time,event,val){
  if(type==='mobile') return {type,label,date,time,event,val,
    slots:['contract','deposit','song_list','invoice'],
    stages:{contract:stContract(),deposit:stDeposit(),song_list:stPlanner(),invoice:stInvoice()}};
  return {type,label,date,time,event,val,
    slots:['contract','song_list','invoice','guestlist'],
    stages:{contract:stContract(),song_list:stRider(),invoice:stInvoice(),guestlist:stGuest()}};
}
function markAllComplete(m){ m.slots.forEach(k=>{ const st=m.stages[k]; st.state = st.S.done ? 'done' : (st.S.sent ? 'sent' : st.state); }); }
function buildModels(){
  const list=[
    mkBooking('mobile','Mobile DJs',{n:'14',d:'SAT',m:'JUN'},'6:00 PM – 11:00 PM','Wedding','$2,400.00'),
    mkBooking('mobile','Mobile DJs',{n:'28',d:'FRI',m:'JUN'},'5:00 PM – 10:00 PM','Anniversary','$1,800.00'),
    mkBooking('club','Club / Bar DJs',{n:'21',d:'FRI',m:'JUN'},'11:00 PM – 3:00 AM','Pulse Nightclub','$900.00'),
    mkBooking('club','Club / Bar DJs',{n:'05',d:'SAT',m:'JUL'},'10:00 PM – 2:00 AM','The Vault','$1,100.00'),
  ];
  markAllComplete(list[1]); markAllComplete(list[3]);  // the two we added: fully done
  return list;
}
let MODELS=buildModels(), OPEN=null;
// Initial load only: Mobile DJ deposit shows Skipped. Reset returns it to Not sent.
MODELS[0].stages.deposit.state='skipped';

function gateInvoice(m){
  const dep=m.stages.deposit, inv=m.stages.invoice;
  if(!dep){ if(inv.state==='locked') inv.state='notsent'; return; }
  const settled=dep.state==='done'||dep.state==='skipped';
  if(inv.state==='locked'&&settled) inv.state='notsent';
  if(!settled&&['notsent','requested','done'].includes(inv.state)) inv.state='locked';
}
function render(){
  MODELS.forEach(gateInvoice);
  const groups=[];
  MODELS.forEach((m,i)=>{ let g=groups.find(x=>x.type===m.type); if(!g){g={type:m.type,label:m.label,items:[]};groups.push(g);} g.items.push({m,i}); });
  document.getElementById('gdc-dash-mount').innerHTML=groups.map(groupHTML).join('');
}
function dateHTML(m){return `<div class="dateb"><span class="n">${m.date.n}</span><span class="dm">${m.date.d}<br>${m.date.m}</span></div>`;}
function groupHTML(g){
  const s=g.items[0].m;
  const stageHeads=s.slots.map(k=>`<span>${shortLabel(k,s.type)}</span>`).join('');
  const heads=`<span class="l">Date</span><span></span><span class="l">Time</span><span class="l">${s.type==='club'?'Venue':'Event'}</span><span class="r">Value</span>${stageHeads}<span></span>`;
  const drows=g.items.map(({m,i})=>drowHTML(m,i)).join('');
  const mobs=g.items.map(({m,i})=>mobCardHTML(m,i)).join('');
  return `<div class="section ${g.type}"><div class="slabel">${g.label}</div>
    <div class="deskwrap"><div class="colheads">${heads}</div>${drows}</div>
    <div class="mobwrap">${mobs}</div></div>`;
}
function drowHTML(m,mi){
  const cells=m.slots.map(k=>cellHTML(m,mi,k)).join('');
  return `<div class="drow">${dateHTML(m)}${m.type==='club'?FLYER:'<div></div>'}<span class="dvtime">${m.time}</span><span class="dvevent">${m.event}</span><span class="dval">${m.val}</span>${cells}<span class="rowchev">${DOWNCHEV}</span></div>`;
}
function mobCardHTML(m,mi){
  const cells=m.slots.map(k=>cellHTML(m,mi,k)).join('');
  return `<div class="card">
    <div class="toprow">${dateHTML(m)}<span class="trtime">${m.time}</span><span class="trevent">${m.event}</span>${m.type==='club'?FLYER:''}<span class="trchev">${DOWNCHEV}</span></div>
    <div class="strip">${cells}</div>
    <div class="valuebar"><span class="lbl">Total Value</span><span class="amt">${m.val}</span></div>
  </div>`;
}
function cellHTML(m,mi,key){
  const stg=m.stages[key], s=stg.S[stg.state];
  const locked=stg.state==='locked', cls=s.cls||'';
  const isOpen=OPEN&&OPEN.mi===mi&&OPEN.key===key;
  const hasMenu=((s.actions&&s.actions.length)||s.info||s.hint)&&!locked;
  const badge=cls==='done'?`<span class="badge">${CHECK}</span>`:'';
  const chev=hasMenu?`<span class="chev">${CHEV}</span>`:'';
  const iconOrDash=locked?`<span class="dash">—</span>`:`<span class="ring">${svg(stg.icon)}${badge}</span>`;
  const inner=`<span class="top">${iconOrDash}${chev}</span><span class="cap" style="color:${capColor(cls,s.cap)}">${s.cap||''}</span>`;
  const btn=hasMenu
    ? `<button class="stbtn ${isOpen?'open':''}" onclick="toggleMenu(${mi},'${key}',event)" title="${headFor(key,m.type)}">${inner}</button>`
    : `<button class="stbtn" disabled title="${headFor(key,m.type)}">${inner}</button>`;
  return `<div class="st ${cls}"><span class="lab">${shortLabel(key,m.type)}</span>${btn}${isOpen?menuHTML(m,mi,key):''}</div>`;
}
function menuHTML(m,mi,key){
  const stg=m.stages[key], s=stg.S[stg.state];
  let h=`<div class="menu"><div class="mh">${headFor(key,m.type)}</div><div class="div"></div>`;
  if(s.info) h+=`<div class="info">${s.info}</div><div class="div"></div>`;
  if(s.hint) h+=`<div class="hint">${s.hint}</div>`;
  (s.actions||[]).forEach((a,i)=>{ h+=`<button class="act ${a.cls||''}" onclick="doAction(${mi},'${key}',${i},event)">${a.label}</button>`; });
  return h+`</div>`;
}
function toggleMenu(mi,key,e){e.stopPropagation();OPEN=(OPEN&&OPEN.mi===mi&&OPEN.key===key)?null:{mi,key};render();}
function doAction(mi,key,i,e){e.stopPropagation();const stg=MODELS[mi].stages[key];const a=stg.S[stg.state].actions[i];if(a.to)stg.state=a.to;OPEN=null;render();}
function resetAll(){MODELS=buildModels();OPEN=null;render();}
document.addEventListener('click',()=>{if(OPEN){OPEN=null;render();}});
render();
