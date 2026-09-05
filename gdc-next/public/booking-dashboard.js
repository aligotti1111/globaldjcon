
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
const FLYER_IMG="data:image/jpeg;base64,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";
function flyerHTML(m){ return m.flyer ? '<div class="flyer flyer-img"><img src="'+m.flyer+'" alt="Event flyer"></div>' : FLYER; }

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
  requested:{cap:'Pending',cls:'waiting',info:'$0 of '+DEP+' received',actions:[
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
  done:{cap:'Complete',cls:'done',actions:[
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
    mkBooking('mobile','Mobile DJs',{n:'29',d:'WED',m:'JUL'},'1:00 PM – 7:00 PM','Wedding','$544.38'),
    mkBooking('mobile','Mobile DJs',{n:'28',d:'MON',m:'SEP'},'5:00 PM – 11:00 PM','Anniversary','$435.50'),
    mkBooking('club','Club / Bar DJs',{n:'21',d:'FRI',m:'JUN'},'11:00 PM – 3:00 AM','Pulse Nightclub','$900.00'),
    mkBooking('club','Club / Bar DJs',{n:'05',d:'SAT',m:'JUL'},'10:00 PM – 2:00 AM','The Vault','$1,100.00'),
  ];
  list[2].flyer=FLYER_IMG;  // top club booking shows a real flyer
  list[2].det={eventType:'Club Night',dateLong:'Friday, June 21, 2026',guests:'450',
    venue:'Pulse Nightclub',room:'Main Room',addr:'88 Ardsley St, Brooklyn, NY 11203',
    bookedBy:'Marcus Reed',phone:'(718) 555-0133',
    pricing:{rate:'$900.00',total:'$900.00',schedule:[{label:'Deposit',val:'$135.00 (15%)'},{label:'Balance due day of event',val:'$765.00'}]},
    log:[
      {who:'HOST',cls:'host',text:'Booking requested',when:'May 30, 2026, 6:02 PM'},
      {who:'YOU',cls:'you',text:'Contract sent to host',when:'May 30, 2026, 8:15 PM'},
      {who:'YOU',cls:'you',text:'Rider sent to host',when:'Jun 1, 2026, 10:40 AM'},
      {who:'YOU',cls:'you',text:'Guest list sent',when:'Jun 18, 2026, 3:22 PM'}
    ]};
  list[3].det={eventType:'Guest DJ Set',dateLong:'Saturday, July 5, 2026',guests:'300',
    venue:'The Vault',room:'Basement Floor',addr:'22 Wither Ln, Jersey City, NJ 07302',
    bookedBy:'Alicia Gomez',phone:'(201) 555-0176',
    pricing:{rate:'$1,100.00',total:'$1,100.00',schedule:[{label:'Deposit',val:'$165.00 (15%)'},{label:'Balance due day of event',val:'$935.00'}]},
    log:[
      {who:'HOST',cls:'host',text:'Booking requested',when:'Jun 10, 2026, 1:18 PM'},
      {who:'YOU',cls:'you',text:'Contract sent to host',when:'Jun 10, 2026, 5:47 PM'},
      {who:'HOST',cls:'host',text:'Contract signed',when:'Jun 11, 2026, 9:03 AM'},
      {who:'YOU',cls:'you',text:'Rider sent to host',when:'Jun 12, 2026, 11:30 AM'}
    ]};
  list[0].det={
    badges:['Includes cocktail hour','Includes ceremony music'],
    dateLong:'Wednesday, July 29, 2026',guests:'200',overtime:'$200.00/hr',
    schedule:[
      {label:'Ceremony',time:'1:00 PM',note:'separate room'},
      {label:'Cocktail hour',time:'2:00 PM',note:'same room as reception'},
      {label:'Reception',time:'3:00 PM – 7:00 PM'}
    ],
    venue:'ligotti',room:'br',addr:'8 Jayne Lane, Staten Island, NY 10307',
    bookedBy:'Anthony l',phone:'(917) 815-8980',pkg:'Premium Wedding',pkgDesc:'6 hrs · lighting · dance floor',
    pricing:{rate:'$500.00',tax:'$44.38 (8.875%)',total:'$544.38',
      schedule:[{label:'Deposit',val:'$81.66 (15%)'},{label:'Balance due day of event',val:'$462.72'}]},
    log:[
      {who:'HOST',cls:'host',text:'Booking requested',when:'Jul 19, 2026, 5:34 PM'},
      {who:'YOU',cls:'you',text:'Balance invoice sent',when:'Jul 22, 2026, 3:16 AM'},
      {who:'YOU',cls:'you',text:'Deposit auto-skipped — balance requested',when:'Jul 22, 2026, 3:16 AM'},
      {who:'YOU',cls:'you',text:'Contract sent to host',when:'Jul 29, 2026, 3:31 AM'}
    ]};
  list[1].det={evSub:'25',dateLong:'Monday, September 28, 2026',guests:'299',overtime:'$100.00/hr',
    venue:'richmond county country club',room:'3',addr:'26 Blythe Place',
    bookedBy:'hhhhhh',phone:'(917) 816-1409',pkg:'first',pkgDesc:'sfs',
    pricing:{rate:'$400.00',discount:'20% OFF — saved $100.00 (was $500.00)',tax:'$35.50 (8.875%)',total:'$435.50',
      schedule:[{label:'Deposit',val:'$65.33 (15%)'},{label:'Balance due day of event',val:'$370.17'}]},
    log:[
      {who:'HOST',cls:'host',text:'Booking requested',when:'May 18, 2026, 2:49 AM'},
      {who:'YOU',cls:'you',text:'Deposit auto-skipped — balance requested',when:'May 18, 2026, 2:50 AM'},
      {who:'YOU',cls:'you',text:'Balance invoice sent',when:'May 18, 2026, 2:50 AM'}
    ]};
  return list;
}
let MODELS=buildModels(), OPEN=null;
// Initial load only: Mobile DJ deposit shows Skipped. Reset returns it to Not sent.
// Wedding: Contract Complete · Deposit Skipped · Playlist Not sent · Balance Pending
MODELS[0].stages.contract.state='done';
MODELS[0].stages.deposit.state='skipped';
MODELS[0].stages.invoice.state='requested';
// Anniversary (card 2): Deposit Skipped · Balance Pending
MODELS[1].stages.deposit.state='skipped';
MODELS[1].stages.invoice.state='requested';
markAllComplete(MODELS[3]);  // The Vault starts fully done (load only; Reset clears all to Not sent)

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
  const note=g.type==='club'?`<p class="cnote">All club / bar bookings display on your public profile — with the option to add a URL for more info.</p>`:'';
  return `<div class="section ${g.type}"><div class="slabel">${g.label}</div>
    <div class="deskwrap"><div class="colheads">${heads}</div>${drows}</div>
    <div class="mobwrap">${mobs}</div>${note}</div>`;
}
function drowHTML(m,mi){
  const cells=m.slots.map(k=>cellHTML(m,mi,k)).join('');
  const canOpen=true;
  const open=!!(m.open&&canOpen);
  const d=m.det||{};
  const badges=(d.badges&&d.badges.length)?`<div class="evtags">${d.badges.map(b=>`<span class="evtag">${b}</span>`).join('')}</div>`:'';
  const timeCell=badges?`<span class="dvtime stacked">${badges}<span>${m.time}</span></span>`:`<span class="dvtime">${m.time}</span>`;
  const row=`<div class="drow${open?' open':''}"${canOpen?` onclick="toggleCard(${mi},event)"`:''}>${dateHTML(m)}${m.type==='club'?flyerHTML(m):'<div></div>'}${timeCell}<span class="dvevent">${m.event}</span><span class="dval">${m.val}</span>${cells}<span class="rowchev${open?' up':''}">${DOWNCHEV}</span></div>`;
  return row+(open?`<div class="deskdetail">${mobDetailHTML(m)}</div>`:'');
}
function mobCardHTML(m,mi){
  const cells=m.slots.map(k=>cellHTML(m,mi,k)).join('');
  const canOpen=true;
  const open=!!(m.open&&canOpen);
  const d=m.det||{};
  const badges=(d.badges&&d.badges.length)?`<div class="evtags">${d.badges.map(b=>`<span class="evtag">${b}</span>`).join('')}</div>`:'';
  const top=`<div class="toprow"${canOpen?` onclick="toggleCard(${mi},event)"`:''}>${dateHTML(m)}<div class="trmid">${badges}<div class="trline"><span class="trtime">${m.time}</span><span class="trevent">${m.event}</span></div></div>${m.type==='club'?flyerHTML(m):''}<span class="trchev${open?' up':''}">${DOWNCHEV}</span></div>`;
  return `<div class="card${open?' open':''}">
    ${top}
    <div class="strip">${cells}</div>
    ${open?mobDetailHTML(m):''}
    <div class="valuebar"><span class="lbl">Total Value</span><span class="amt">${m.val}</span></div>
  </div>`;
}
function mobDetailHTML(m){
  const d=m.det||{};
  const sched=(d.schedule||[]).map(s=>`<div class="schrow"><span class="schl">${s.label}</span><span class="scht">${s.time||''}</span>${s.note?`<span class="schn">· ${s.note}</span>`:''}</div>`).join('');
  const pr=d.pricing;
  const pricing = pr
    ? `<div class="dpricerow"><span class="dk2">Agreed Rate</span><span class="dv rt">${pr.rate}${pr.discount?`<span class="disc">${pr.discount}</span>`:''}</span></div>
       ${pr.tax?`<div class="dpricerow"><span class="dk2">Tax</span><span class="dv">${pr.tax}</span></div>`:''}
       <div class="dpricerow total"><span class="ptot">Total (with tax)</span><span class="dv price">${pr.total}</span></div>
       ${(pr.schedule&&pr.schedule.length)?`<div class="paysched"><div class="pshead">Payment schedule</div>${pr.schedule.map(x=>`<div class="dpricerow"><span class="dk2">${x.label}</span><span class="dv">${x.val}</span></div>`).join('')}</div>`:''}`
    : `<div class="dpricerow"><span class="dk2">Agreed Rate</span><span class="dv price">${d.rate||m.val}</span></div>`;
  const log=(d.log||[]).map(e=>`<div class="logrow"><span class="logdot ${e.cls}"></span><div class="logbody"><div class="logtop"><span class="logwho ${e.cls}">${e.who}</span><span class="logtext">${e.text}</span></div><div class="logwhen">${e.when}</div></div></div>`).join('');
  return `<div class="mobdetail">
    <div class="dsec">
      <span class="dpill">EVENT</span>
      <div class="dgrid3">
        <div class="df"><span class="dk">Event type</span><span class="dv">${d.eventType||m.event}${d.evSub?`<span class="dsub">${d.evSub}</span>`:''}</span></div>
        <div class="df"><span class="dk">Event date</span><span class="dv">${d.dateLong||''}</span></div>
        <div class="df"><span class="dk">Guest count</span><span class="dv">${d.guests||''}</span></div>
      </div>
      ${sched?`<div class="schwrap"><div class="schhead">Schedule</div>${sched}</div>`:`<div class="df evtime"><span class="dk">Event time</span><span class="dv time">${m.time}</span></div>`}
      ${d.overtime?`<div class="dovertime"><span class="dk">Overtime</span><b>${d.overtime}</b><a class="dlink">Send invoice / receipt</a></div>`:''}
    </div>
    <div class="drow2">
      <div class="dsec">
        <span class="dpill">VENUE</span>
        <div class="dgrid2">
          <div class="df"><span class="dk">Venue name</span><span class="dv">${d.venue||''}</span></div>
          <div class="df"><span class="dk">Room details</span><span class="dv">${d.room||''}</span></div>
        </div>
        <div class="df"><span class="dk">Venue address</span><span class="dv"><a class="dlink">${d.addr||''}</a></span></div>
      </div>
      <div class="dsec">
        <span class="dpill">HOST</span>
        <div class="dgrid2">
          <div class="df"><span class="dk">Booked by</span><span class="dv">${d.bookedBy||''}</span></div>
          <div class="df"><span class="dk">Contact phone</span><span class="dv">${d.phone||''}</span></div>
        </div>
        <button class="dmsg">✉ Message host</button>
      </div>
    </div>
    ${d.pkg?`<div class="dsec"><span class="dpill">PACKAGE</span><div class="dv pkgname">${d.pkg}</div><div class="dsub">${d.pkgDesc||''}</div></div>`:''}
    <div class="dsec pricing"><span class="dpill">PRICING</span>${pricing}</div>
    <div class="dsec">
      <div class="dk">Notes about event</div>
      <div class="noterow"><span class="noteph">Add note about event…</span><span class="notepost">POST</span></div>
    </div>
    ${log?`<div class="dsec"><div class="loghead"><span class="dk">Booking log</span><span class="loglegend"><span class="logdot you"></span>You<span class="logdot host"></span>Host</span></div><div class="loglist">${log}</div></div>`:''}
  </div>`;
}
function toggleCard(mi,e){ if(e)e.stopPropagation(); const m=MODELS[mi]; m.open=!m.open; OPEN=null; render(); }
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
