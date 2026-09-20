import {makeDemo,stats,validateFrame,toCsv,STALE_MS} from './model.js';
import {MODULE_LABELS,emptyFrame,StmLogParser} from './stm-log.js';
import {SampleTracker} from './log-format.js';
import {Recorder} from './recorder.js';
import {TelemetrySource} from './live.js';
import {loggingHtml,guideHtml} from './workspace-views.js';
const $=id=>document.getElementById(id);
const fmt=(v,d=1)=>v===null||v===undefined?'—':Number(v).toFixed(d);
const cellId=id=>'C'+String(id).padStart(3,'0');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let frame=makeDemo(),mode='demo',view='overview',scenario='drive',tick=0,stale=false,endpoint='',token='',epoch=0,busy=false,selectedCell=null,search='',filter='all',sort='id',chartMetric='power',chartRange=60;
let demoSequence=0;
let tracker=new SampleTracker(),receivedAt=Date.now(),rateTimes=[],demoHz=20,sourceError='',rejected=0,dirty=true,lastRender=0,thermalModule='all',sessions=[],selectedSession='',selectedPart=0;
const recorder=new Recorder(()=>{dirty=true;updateRecordRibbon();});
let history=[],events=[{time:Date.now(),title:'Sesi demo dimulai',detail:'140 sel simulasi · tidak ada koneksi hardware'}];
function remember(){if(history.length&&frame.timestampMs-history.at(-1).t<200)return;const s=stats(frame);history.push({t:frame.timestampMs,power:s.power,soc:frame.socPct,current:frame.currentA,voltage:s.pack});history=history.filter(p=>p.t>=frame.timestampMs-900000).slice(-4500);}
for(let i=59;i>=0;i--){const d=makeDemo(-i,'drive',Date.now()-i*1000),s=stats(d);history.push({t:d.timestampMs,power:s.power,soc:d.socPct,current:d.currentA,voltage:s.pack});}
function event(title,detail=''){events.unshift({time:Date.now(),title,detail});events=events.slice(0,100);}
function toast(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4000);}
function value(id,v,unit,d=1){$(id).innerHTML=fmt(v,d)+`<small> ${unit}</small>`;}
function renderHeader(){
 const s=stats(frame);stale=Date.now()-receivedAt>STALE_MS||Date.now()-frame.timestampMs>STALE_MS;
 document.body.classList.toggle('stale-data',stale);
 value('packVoltage',s.pack,'V');value('packCurrent',frame.currentA,'A');value('cellDelta',s.delta,'mV',0);value('maxTemperature',s.maxTemp,'°C');
 $('validCount').textContent=`${s.valid} / 140 cells`;$('packPower').textContent=fmt(s.power,2)+' kW';$('currentDirection').textContent=frame.currentA===null?'Tidak tersedia':frame.currentA>0?'Discharging':frame.currentA<0?'Charging':'Idle';
 $('cellExtrema').textContent=s.low?`${cellId(s.low.id)} → ${cellId(s.high.id)}`:'Data sel tidak tersedia';$('temperatureCount').textContent=`${frame.temperatures.filter(t=>t.celsius!==null).length} / 240 kanal`;$('temperatureRange').textContent=fmt(s.maxTemp===null?null:s.maxTemp-s.minTemp)+' °C spread';
 const faults=frame.faults.length,unknown=s.valid<140||frame.cells.some(c=>c.status==='unknown')||frame.temperatures.length===0||frame.temperatures.some(t=>(!frame.modules||frame.modules.find(m=>m.id===t.moduleId)?.installed)&&(t.celsius===null||t.status==='unknown'))||['contactor','interlock','isolation'].some(k=>frame.system[k]==='unknown');
 const severe=frame.system.interlock==='open'||frame.system.isolation==='fault'||frame.faults.some(f=>f.severity==='fault')||frame.cells.some(c=>c.status==='fault')||frame.temperatures.some(t=>t.status==='fault');
 const warning=frame.cells.some(c=>c.status==='warning')||frame.temperatures.some(t=>t.status==='warning');
 $('faultBadge').textContent=faults;
 $('statusRibbon').className='status-ribbon'+(stale?' warning':severe?' fault':faults||unknown||warning?' warning':'');
 $('statusIcon').textContent=stale||faults||unknown||warning||severe?'!':'✓';
 $('packStatus').textContent=stale?'Telemetry terputus':severe?'Fault dilaporkan':faults||warning?'Perhatian diperlukan':unknown?'Data belum lengkap':mode==='demo'?'Demo berjalan normal':'Telemetry diterima';
 $('statusDetail').textContent=stale?'Data terakhir ditahan · status saat ini tidak diketahui':frame.faults[0]?.message||(frame.quality==='legacy-unverified'?'Log STM: suhu °C; umur data per kanal belum dilaporkan.':mode==='demo'?'Menampilkan data simulasi · belum terhubung ke BMS':'Status dan SOC mengikuti laporan firmware');
 $('sampleAge').textContent=stale?`${Math.floor((Date.now()-frame.timestampMs)/1000)} S AGO`:`${actualRate().toFixed(1)} sampel/s · ${mode.toUpperCase()}`;
 $('connectionLabel').innerHTML=`<i class="dot ${mode==='demo'||stale?'amber':''}"></i>${stale?'STALE':mode==='demo'?'DEMO':'LIVE'}`;
 $('sideSource').textContent=mode==='demo'?'Demo telemetry':stale?'Telemetry stale':'Gateway connected';$('sourceDescription').textContent=mode==='demo'?'Eksplorasi tanpa hardware':'140S · '+mode.toUpperCase();
 $('scenario').disabled=mode!=='demo';$('clock').textContent=new Date().toLocaleTimeString('id-ID',{hour12:false});
}
function mapHtml(){const s=stats(frame);return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">Tegangan seluruh sel</h2><p class="panel-subtitle">140 sel seri · pilih sel untuk melihat detail</p></div><span class="tag">140S</span></div><div class="cell-summary"><span>MINIMUM<b>${fmt(s.low?.voltageV,3)} V</b></span><span>AVERAGE<b>${fmt(s.average,3)} V</b></span><span>MAXIMUM<b>${fmt(s.high?.voltageV,3)} V</b></span><span>BALANCING<b>${stale?'—':s.balancing} sel</b></span></div><div class="map-wrap">${Array.from({length:10},(_,row)=>`<div class="cell-row"><span class="row-label">${String(row+1).padStart(2,'0')}</span><div class="cell-grid">${frame.cells.slice(row*14,row*14+14).map(c=>{const ratio=c.voltageV===null||!s.high||s.delta===0?0:(c.voltageV-s.low.voltageV)/(s.high.voltageV-s.low.voltageV);return `<button class="cell ${c.voltageV===null?'unknown':c.status} ${c.balancing?'balancing':''}" data-cell="${c.id}"  aria-label="Sel ${cellId(c.id)}, ${fmt(c.voltageV,3)} volt${c.balancing?', balancing':''}"><small>${String(c.id).padStart(3,'0')}</small><strong>${fmt(c.voltageV,3)}</strong></button>`;}).join('')}</div></div>`).join('')}</div><div class="map-legend"><span>Nilai tegangan dalam volt</span><span class="legend-items"><span><i></i>Warning</span><span><i class="blue"></i>Balancing</span><span><i class="gray"></i>No data</span></span></div><div class="panel-note">10 baris × 14 sel untuk tampilan; bukan pemetaan modul fisik. Warna mengikuti status; bukan evaluasi batas proteksi.</div></article>`;}
function socHtml(){return `<article class="panel soc-panel"><div class="panel-head"><h2 class="panel-title">State of charge</h2><span class="tag">${mode==='demo'?'DEMO':'FIRMWARE'}</span></div><div class="soc-main"><strong>${fmt(frame.socPct)}<small> %</small></strong><p>${stale?'Data terakhir':frame.socPct===null?'Estimator belum tersedia':mode==='demo'?'Simulasi':'Nilai dari firmware'}</p><div class="soc-bar" role="meter" aria-label="SOC" aria-valuemin="0" aria-valuemax="100" ${frame.socPct===null?'':`aria-valuenow="${frame.socPct}"`}><span style="width:${frame.socPct??0}%"></span></div></div><div class="soc-detail"><div class="detail-row"><span>Energi tersisa</span><b>${fmt(frame.remainingKwh,2)} kWh</b></div><div class="detail-row"><span>State of health</span><b>${fmt(frame.sohPct)} %</b></div><div class="detail-row"><span>Cycle count</span><b>${fmt(frame.cycles,0)}</b></div></div></article>`;}
function chartHtml(metric='power',range=60){
 const units={power:'kW',soc:'%',current:'A',voltage:'V'};const points=history.filter(p=>p.t>=frame.timestampMs-range*1000);const vals=points.filter(p=>p[metric]!==null);
 if(vals.length<2)return '<div class="chart-empty">Menunggu sampel telemetry berikutnya…</div>';
 const lo=Math.min(...vals.map(p=>p[metric])),hi=Math.max(...vals.map(p=>p[metric]));const pad=Math.max((hi-lo)*.2,metric==='soc'?.1:1);const min=lo-pad,max=hi+pad;const W=650,H=160,left=47,right=12,top=10,bottom=24;
 const start=points[0].t,end=points.at(-1).t;
 const xy=p=>[left+(p.t-start)/(end-start||1)*(W-left-right),top+(max-p[metric])/(max-min)*(H-top-bottom)];
 let line='',last=null;for(const p of points){if(p[metric]===null){last=null;continue;}const [x,y]=xy(p);line+=`${last&&p.t-last.t<=2500?'L':'M'}${x.toFixed(1)},${y.toFixed(1)} `;last=p;}
 return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Grafik ${metric}, ${range} detik terakhir, satuan ${units[metric]}">${[0,1,2,3].map(i=>{const y=top+i*(H-top-bottom)/3;return `<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"/><text x="0" y="${y+3}">${(max-i*(max-min)/3).toFixed(1)}</text>`;}).join('')}<path d="${line}" fill="none" stroke="${metric==='soc'?'#8bd4ae':'#78c9a2'}" stroke-width="2.3" vector-effect="non-scaling-stroke"/>${[0,1,2,3,4].map(i=>`<text x="${left+i*(W-left-right)/4}" y="${H-2}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${new Date(start+i*(end-start)/4).toLocaleTimeString('id-ID',{hour12:false})}</text>`).join('')}</svg></div>`;
}
function powerPanel(){const s=stats(frame);return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">Riwayat daya</h2><p class="panel-subtitle">${mode==='demo'?'Simulasi':'Telemetry'} · positif discharge, negatif charge</p></div><span class="tag">60 SEC</span></div><div class="chart-readings"><label>PACK POWER<strong>${fmt(s.power,2)} <small>kW</small></strong></label><label>CURRENT<strong style="color:#d5dce4">${fmt(frame.currentA)} <small>A</small></strong></label></div>${chartHtml()}<div class="chart-caption"><span>${mode==='demo'?'SIMULATED TELEMETRY':'GATEWAY TELEMETRY'}</span><span>Refresh layar 4 Hz</span></div></article>`;}
function checksHtml(){const z=frame.system;const label=(v)=>stale?'UNKNOWN':v.toUpperCase();return `<article class="panel"><div class="panel-head"><h2 class="panel-title">Status sistem</h2><span class="tag">${mode==='demo'?'DEMO':'BMS'}</span></div><div class="system-list"><div class="check-row"><span>HV contactor</span><b class="${stale||z.contactor!=='closed'?'warn':''}">${label(z.contactor)}</b></div><div class="check-row"><span>HV interlock</span><b class="${stale||z.interlock==='unknown'?'warn':z.interlock==='open'?'bad':''}">${label(z.interlock)}</b></div><div class="check-row"><span>Isolation</span><b class="${stale||z.isolation==='unknown'?'warn':z.isolation==='fault'?'bad':''}">${label(z.isolation)}</b></div><div class="check-row"><span>CAN errors</span><b>${stale?'UNKNOWN':fmt(z.canErrorCount,0)}</b></div><div class="check-row"><span>isoSPI / PEC errors</span><b>${stale?'UNKNOWN':fmt(z.pecErrorCount,0)}</b></div></div><p class="panel-note">Status laporan firmware. Pengaktifan contactor tetap melalui sistem kendaraan.</p></article>`;}
function renderView(){
 const focused=document.activeElement,scope=focused?.closest('dialog')?.id;
 const focusAttr=focused?.hasAttribute('data-cell')?'data-cell':focused?.hasAttribute('data-close')?'data-close':focused?.hasAttribute('data-metric')?'data-metric':null;
 const focusValue=focusAttr?focused.getAttribute(focusAttr):null;
 if(view==='overview')$('viewContent').innerHTML=`<div class="overview-grid">${mapHtml()}${socHtml()}</div><div class="bottom-grid">${powerPanel()}${checksHtml()}</div>`;
 else if(view==='cells')renderCells();
 else if(view==='energy')renderEnergy();
 else if(view==='thermal')renderThermal();
 else if(view==='logging')renderLogging();
 else if(view==='guide')renderGuide();
 else renderDiagnostics();
 if(selectedCell!==null)renderCellDialog();
 if(focusAttr)(scope?$(scope):$('viewContent'))?.querySelector(`[${focusAttr}="${focusValue}"]`)?.focus({preventScroll:true});
}
function renderCells(){const s=stats(frame);let cells=frame.cells.filter(c=>(!search||cellId(c.id).toLowerCase().includes(search.toLowerCase())||String(c.id)===search)&&(filter==='all'||filter==='balancing'&&c.balancing||filter==='attention'&&(c.status!=='normal'||c.voltageV===null)));cells.sort(sort==='voltage'?(a,b)=>(b.voltageV??-1)-(a.voltageV??-1):(a,b)=>a.id-b.id);$('viewContent').innerHTML=`<div class="toolbar"><input class="search" id="cellSearch" aria-label="Cari sel" placeholder="Cari sel, mis. C087 atau 140" value="${escape(search)}"><select id="cellFilter" aria-label="Filter sel"><option value="all" ${filter==='all'?'selected':''}>Semua sel</option><option value="balancing" ${filter==='balancing'?'selected':''}>Balancing aktif</option><option value="attention" ${filter==='attention'?'selected':''}>Perlu perhatian</option></select><select id="cellSort" aria-label="Urutan sel"><option value="id" ${sort==='id'?'selected':''}>Urutan nomor sel</option><option value="voltage" ${sort==='voltage'?'selected':''}>Tegangan tertinggi</option></select><span class="tag">${cells.length} / 140 SEL</span></div><article class="panel table-wrap"><table><thead><tr><th>Cell ID</th><th>Voltage</th><th>Δ dari rata-rata</th><th>Balancing</th><th>Status firmware</th></tr></thead><tbody>${cells.map(c=>`<tr><td><button data-cell="${c.id}">${cellId(c.id)} ↗</button></td><td>${fmt(c.voltageV,3)} V</td><td>${fmt(c.voltageV===null||s.average===null?null:(c.voltageV-s.average)*1000)} mV</td><td>${stale?'UNKNOWN':c.balancing===null?'UNKNOWN':c.balancing?'ACTIVE':'OFF'}</td><td class="${c.status==='fault'?'bad':c.status==='warning'?'warn':''}">${stale?'STALE':c.voltageV===null?'NO DATA':c.status.toUpperCase()}</td></tr>`).join('')}</tbody></table>${cells.length?'':'<div class="empty">Tidak ada sel yang cocok dengan filter.</div>'}</article>`;}
function renderEnergy(){$('viewContent').innerHTML=`<div class="view-grid"><article class="panel"><div class="panel-head"><div><h2 class="panel-title">SOC & energy history</h2><p class="panel-subtitle">Riwayat sesi ini · nilai SOC dari ${mode==='demo'?'simulator':'firmware'}</p></div><select id="chartRange" aria-label="Rentang grafik"><option value="60" ${chartRange===60?'selected':''}>1 menit</option><option value="300" ${chartRange===300?'selected':''}>5 menit</option><option value="900" ${chartRange===900?'selected':''}>15 menit</option></select></div><div class="chart-readings"><div class="segmented">${[['soc','SOC'],['power','Power'],['current','Current'],['voltage','Voltage']].map(([m,l])=>`<button data-metric="${m}" class="${chartMetric===m?'active':''}">${l}</button>`).join('')}</div></div>${chartHtml(chartMetric,chartRange)}<div class="chart-caption"><span>${history.length} sampel tersimpan</span><span>Riwayat hilang ketika sumber data berganti</span></div></article>${socHtml()}<article class="panel"><div class="panel-head"><h2 class="panel-title">Available energy</h2><span class="tag">${mode==='demo'?'DEMO':'BMS'}</span></div><div class="large-stat">${fmt(frame.remainingKwh,2)} <small>kWh</small></div><p class="explanation">Energi tersisa mengikuti estimasi firmware. Nilai ini tidak dihitung dari perkalian SOC dengan tegangan sesaat.</p></article><article class="panel"><div class="panel-head"><h2 class="panel-title">Battery health</h2></div><div class="soc-detail"><div class="detail-row"><span>Usable capacity</span><b>${fmt(frame.capacityAh)} Ah</b></div><div class="detail-row"><span>State of health</span><b>${fmt(frame.sohPct)} %</b></div><div class="detail-row"><span>Cycle count</span><b>${fmt(frame.cycles,0)}</b></div></div><p class="explanation">SOC, SOH, kapasitas, dan cycle count ditampilkan sebagai “—” jika estimator firmware belum tersedia.</p></article></div>`;}
function renderThermal(){
 const modules=frame.modules??MODULE_LABELS.map((label,i)=>({id:i+1,label,installed:false}));
 const mapped=frame.temperatures.filter(t=>t.moduleId&&t.channel);
 $('viewContent').innerHTML=`<div class="toolbar"><div><h2 class="panel-title">10 modul · 24 kanal per modul</h2><p class="panel-subtitle">Urutan log STM: 1A–4A, 1B–4B. Slot M09 dan M10 disiapkan untuk ekspansi.</p></div><select id="thermalModule" aria-label="Pilih modul"><option value="all">Semua modul</option>${modules.map(m=>`<option value="${m.id}" ${thermalModule===String(m.id)?'selected':''}>${escape(m.label)}</option>`).join('')}</select></div>${!mapped.length?'<div class="notice">Telemetry v1 tidak memiliki mapping modul. Minta gateway mengirim v2; sensor tidak dipetakan otomatis.</div>':''}${frame.quality==='legacy-unverified'?'<div class="notice">Nilai °C mengikuti byte log STM. Firmware belum menandai sensor yang belum diterima atau kedaluwarsa; nilai 0 dapat berasal dari inisialisasi.</div>':''}<div class="thermal-modules">${modules.filter(m=>thermalModule==='all'||String(m.id)===thermalModule).map(m=>{
 const ts=mapped.filter(t=>t.moduleId===m.id),vs=ts.filter(t=>t.celsius!==null).map(t=>t.celsius);const worst=ts.some(t=>t.status==='fault')?'fault':ts.some(t=>t.status==='warning')?'warning':'';
 return `<article class="panel module-card ${worst}"><div class="panel-head"><div><h2 class="panel-title">Modul ${escape(m.label)}</h2><p class="panel-subtitle">${m.installed?`${vs.length} / 24 kanal terisi`:'Belum terpasang'}</p></div><span class="tag">${stale?'STALE':!m.installed?'RESERVED':frame.quality==='legacy-unverified'?'LOG STM':mode==='demo'?'DEMO':'BMS'}</span></div><div class="module-range"><span>Min <b>${vs.length?fmt(Math.min(...vs)):'—'} °C</b></span><span>Rata-rata <b>${vs.length?fmt(vs.reduce((a,b)=>a+b,0)/vs.length):'—'} °C</b></span><span>Max <b>${vs.length?fmt(Math.max(...vs)):'—'} °C</b></span></div><div class="thermal-channels">${Array.from({length:24},(_,i)=>{const t=ts.find(t=>t.channel===i+1);return `<div class="temp-card ${t?.status??'unknown'}" title="${escape(m.label)} kanal ${i+1}; ${stale?'stale':t?.status??'unknown'}"><span>T${String(i+1).padStart(2,'0')}</span><strong>${fmt(t?.celsius)}</strong></div>`;}).join('')}</div></article>`;
 }).join('')}</div>`;
}
function renderDiagnostics(){$('viewContent').innerHTML=`<div class="view-grid"><div class="stack"><article class="panel"><div class="panel-head"><h2 class="panel-title">${stale?'Fault terakhir':'Active faults'}</h2><span class="tag">${frame.faults.length} REPORTED</span></div>${frame.faults.length?`<ol class="events">${frame.faults.map(f=>`<li><span class="${f.severity==='fault'?'bad':'warn'}">${escape(f.severity.toUpperCase())}</span><div>${escape(f.message)}<small>${escape(f.code)} · ${mode==='demo'?'SIMULASI':'FIRMWARE'}</small></div></li>`).join('')}</ol>`:`<div class="empty"><span class="empty-symbol">${stale?'?':'✓'}</span>${stale?'Status fault saat ini tidak diketahui.':'Tidak ada fault yang dilaporkan.'}<br>${mode==='demo'?'Data simulasi; bukan pemeriksaan pack nyata.':'Status mengikuti telemetry yang diterima.'}</div>`}</article><article class="panel"><div class="panel-head"><h2 class="panel-title">Session event log</h2><span class="tag">${events.length} EVENTS</span></div><ol class="events">${events.map(e=>`<li><time>${new Date(e.time).toLocaleTimeString('id-ID',{hour12:false})}</time><div>${escape(e.title)}<small>${escape(e.detail)}</small></div></li>`).join('')}</ol></article></div><div class="stack">${checksHtml()}<article class="panel"><div class="panel-head"><h2 class="panel-title">Balancing status</h2></div><div class="large-stat">${stale?'—':stats(frame).balancing} <small>/ 140 cells</small></div><p class="explanation">Status balancing diterima per sel. Kebijakan dan switching balancing tetap divalidasi firmware. Tidak ada override dari dashboard.</p></article></div></div>`;}
function renderCellDialog(){const c=frame.cells.find(x=>x.id===selectedCell),s=stats(frame);if(!c)return;$('cellDialogContent').innerHTML=`<div class="dialog-title"><div><div class="eyebrow">CELL INSPECTOR / ${mode.toUpperCase()}</div><h2>${cellId(c.id)}</h2></div><button class="icon-button" data-close="cellDialog" aria-label="Tutup detail sel">×</button></div><div class="large-stat" style="padding:18px 0">${fmt(c.voltageV,3)} <small>V</small></div><div class="detail-row"><span>Deviasi dari rata-rata</span><b>${fmt(c.voltageV===null?null:(c.voltageV-s.average)*1000)} mV</b></div><div class="detail-row"><span>Status firmware</span><b>${stale?'STALE':c.voltageV===null?'NO DATA':c.status.toUpperCase()}</b></div><div class="detail-row"><span>Balancing</span><b>${stale?'UNKNOWN':c.balancing===null?'UNKNOWN':c.balancing?'ACTIVE':'OFF'}</b></div><div class="detail-row"><span>Timestamp</span><b>${new Date(frame.timestampMs).toLocaleTimeString('id-ID',{hour12:false})}</b></div><p>Nomor sel logis ${c.id} dari 140. Pemetaan AFE dan sensor temperatur perlu mengikuti konfigurasi hardware.</p><div class="dialog-actions"><button class="button" data-cell="${Math.max(1,c.id-1)}" ${c.id===1?'disabled':''}>← Sel sebelumnya</button><button class="button" data-cell="${Math.min(140,c.id+1)}" ${c.id===140?'disabled':''}>Sel berikutnya →</button></div>`;}
const views={overview:['Ringkasan pack','Tegangan, arus, kondisi sel, dan temperatur.'],cells:['Sel baterai','140 slot sel seri. Pilih sel untuk inspeksi.'],energy:['SOC & energi','Estimasi firmware dan riwayat daya sesi ini.'],thermal:['Temperatur modul','192 kanal saat ini; 240 kanal untuk 10 modul.'],diagnostics:['Diagnostik','Status firmware, kualitas data, dan kejadian koneksi.'],logging:['Perekaman data','Satu baris CSV per sampel baru. Laju mengikuti sumber data.'],guide:['Panduan penggunaan','Koneksi, pemetaan modul, dan ekspor hasil pengujian.']};
function setView(next){if(!views[next])return;view=next;location.hash=next;$('pageTitle').innerHTML=views[next][0];$('pageSubtitle').textContent=views[next][1];document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===next);b.setAttribute('aria-current',b.dataset.view===next?'page':'false');});renderView();}
document.addEventListener('click',e=>{const nav=e.target.closest('[data-view]');if(nav)setView(nav.dataset.view);const cell=e.target.closest('[data-cell]');if(cell){selectedCell=Number(cell.dataset.cell);renderCellDialog();if(!$('cellDialog').open)$('cellDialog').showModal();}const close=e.target.closest('[data-close]');if(close)$(close.dataset.close).close();const metric=e.target.closest('[data-metric]');if(metric){chartMetric=metric.dataset.metric;renderView();}});
document.addEventListener('change',e=>{if(e.target.id==='thermalModule'){thermalModule=e.target.value;renderView();}if(e.target.id==='cellFilter'){filter=e.target.value;renderView();}if(e.target.id==='cellSort'){sort=e.target.value;renderView();}if(e.target.id==='chartRange'){chartRange=Number(e.target.value);renderView();}});
document.addEventListener('input',e=>{if(e.target.id==='cellSearch'){search=e.target.value;const cursor=e.target.selectionStart;renderView();$('cellSearch').focus();$('cellSearch').setSelectionRange(cursor,cursor);}});
$('cellDialog').addEventListener('close',()=>selectedCell=null);
function openConnection(){$('connectionError').textContent='';$('connectionDialog').showModal();}
$('connectButton').onclick=openConnection;$('sourceButton').onclick=openConnection;
$('scenario').onchange=()=>{scenario=$('scenario').value;event('Skenario demo berubah',$('scenario').selectedOptions[0].textContent);if(scenario!=='offline'){acceptFrame(makeDemo(tick/20,scenario),'demo');}renderHeader();renderView();};
function actualRate(){const now=Date.now();rateTimes=rateTimes.filter(t=>now-t<5000);if(rateTimes.length<2)return 0;return (rateTimes.length-1)/Math.max(.001,(rateTimes.at(-1)-rateTimes[0])/1000);}
function acceptFrame(input,source){
 try{if(source==='demo')input={...input,sequence:++demoSequence};const next=validateFrame(input);if(!tracker.accept(next))return false;const prev=frame?.faults.map(f=>f.code).join();frame=next;mode=source==='demo'?'demo':source;receivedAt=Date.now();rateTimes.push(receivedAt);remember();recorder.push(frame,receivedAt);sourceError='';dirty=true;
 if(prev!==frame.faults.map(f=>f.code).join())event('Status fault berubah',`${frame.faults.length} fault dilaporkan`);return true;
 }catch(e){rejected++;sourceError=e.message;dirty=true;return false;}
}
const source=new TelemetrySource({onFrame:acceptFrame,onError:message=>{sourceError=message;rejected++;dirty=true;},onStatus:(kind,message)=>{event(message);if(kind!=='ended')mode=kind;dirty=true;}});
function resetSource(nextMode){mode=nextMode;tracker=new SampleTracker();history=[];rateTimes=[];rejected=0;sourceError='';frame=emptyFrame(0);receivedAt=0;dirty=true;}
function updateRecordRibbon(){const r=$('recordRibbon');if(!r)return;r.hidden=!recorder.active&&!recorder.failure;r.textContent=recorder.active?`MEREKAM · ${recorder.session?.savedRows??0} baris tersimpan · sumber ${mode.toUpperCase()}`:recorder.failure;}
function renderLogging(){$('viewContent').innerHTML=loggingHtml({recorder,mode,rate:actualRate(),rejected,tracker,sessions,selectedSession,selectedPart,demoHz});}
function renderGuide(){$('viewContent').innerHTML=guideHtml();}
async function refreshSessions(){sessions=await recorder.list();if(!selectedSession||!sessions.some(s=>s.id===selectedSession))selectedSession=sessions[0]?.id??'';dirty=true;if(view==='logging')renderView();}
async function endRecording(reason){if(recorder.active)await recorder.stop(reason);await refreshSessions();}
function downloadText(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
document.addEventListener('click',async e=>{
 try{
 if(e.target.id==='startRecording'){
   if(stale)throw new Error('Tunggu telemetry baru sebelum mulai merekam.');
   await recorder.start(mode,$('sessionName').value.trim()||`BMS ${mode}`);await refreshSessions();selectedSession=recorder.session.id;selectedPart=0;renderView();
 }
 if(e.target.id==='stopRecording'){await endRecording();toast('Sesi disimpan. Pilih bagian CSV untuk diunduh.');renderView();}
 if(e.target.id==='refreshSessions')await refreshSessions();
 if(e.target.id==='exportRecording'){
   const id=selectedSession||recorder.session?.id;if(!id)throw new Error('Pilih sesi terlebih dahulu.');
   const result=await recorder.export(id,selectedPart);downloadText(result.text,`arjuna-bms-${result.meta.source}-${id.slice(0,8)}-part-${selectedPart+1}.csv`);toast(`CSV bagian ${selectedPart+1} berhasil disiapkan.`);
 }
 }catch(err){toast(err.message);}
});
document.addEventListener('change',e=>{
 if(e.target.id==='transport'){const serial=e.target.value==='serial';$('serialFields').hidden=!serial;$('networkFields').hidden=serial;$('pollField').hidden=e.target.value!=='poll';$('endpoint').required=!serial;}
 if(e.target.id==='demoRate'){demoHz=Number(e.target.value);dirty=true;}
 if(e.target.id==='recordedSession'){selectedSession=e.target.value;selectedPart=0;renderView();}
 if(e.target.id==='recordedPart')selectedPart=Number(e.target.value);
});
$('connectionDialog').addEventListener('close',()=>{$('token').value='';});
$('demoButton').onclick=async()=>{try{await endRecording('Sumber diganti ke demo.');await source.disconnect();resetSource('demo');scenario='drive';$('scenario').value='drive';tick=0;acceptFrame(makeDemo(++tick/20,scenario),'demo');$('connectionDialog').close();renderHeader();renderView();}catch(e){$('connectionError').textContent=e.message;}};
$('connectionForm').onsubmit=async e=>{
 e.preventDefault();$('submitConnection').disabled=true;$('connectionError').textContent='';
 try{
   const kind=$('transport').value;
   // Ask the browser for serial permission before the first await loses user activation.
   if(kind==='serial'){
     const connecting=source.serial($('mapLocalCells').checked);
     await endRecording('Sumber diganti ke UART STM.');resetSource('serial');await connecting;
   }else{await endRecording('Sumber gateway diganti.');resetSource(kind);await source.network($('endpoint').value.trim(),$('token').value,kind,Number($('pollInterval').value));}
   $('token').value='';$('connectionDialog').close();renderHeader();renderView();
 }catch(err){$('connectionError').textContent=err.message;sourceError=err.message;dirty=true;}
 finally{$('submitConnection').disabled=false;}
};
$('exportButton').onclick=()=>{downloadText('\uFEFF'+toCsv(frame,mode,stale),`arjuna-bms-snapshot-${mode}-${Date.now()}.csv`);toast('Snapshot sel diekspor. Untuk time series gunakan Perekaman.');};
let nextDemoAt=performance.now();
function pump(){
 const now=performance.now();
 if(mode==='demo'&&scenario!=='offline'&&now>=nextDemoAt){tick++;acceptFrame(makeDemo(tick/20,scenario),'demo');nextDemoAt=now+1000/demoHz;}
 setTimeout(pump,Math.min(10,1000/demoHz));
}
function refreshUI(){
 const wasStale=stale;renderHeader();updateRecordRibbon();
 if(wasStale!==stale){event(stale?'Telemetry terputus':'Telemetry pulih');dirty=true;}
 if(sourceError)$('statusDetail').textContent=sourceError;
 const active=document.activeElement;
 const editing=active?.matches('input,select')||active?.closest('#connectionDialog');
 if(!editing&&(dirty||view==='logging')&&view!=='guide'){renderView();dirty=false;}
}
window.addEventListener('hashchange',()=>setView(location.hash.slice(1)));
window.addEventListener('beforeunload',e=>{if(recorder.active){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recorder.active)event('Tab di latar belakang','Browser dapat memperlambat akuisisi; periksa laju aktual.');});
renderHeader();setView(views[location.hash.slice(1)]?location.hash.slice(1):'overview');pump();setInterval(refreshUI,250);refreshSessions().catch(e=>toast('Penyimpanan lokal: '+e.message));

// Optional browser-native read tool uses the same accepted telemetry as the HMI.
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 const readTool={name:'read_bms_cells',title:'Read ARJUNA BMS cells',description:'Read selected logical cells and pack summary from the visible BMS telemetry. Includes demo/live provenance and freshness. Does not send hardware commands.',inputSchema:{type:'object',properties:{cellIds:{type:'array',items:{type:'integer',minimum:1,maximum:140},minItems:1,maxItems:140,uniqueItems:true}},required:['cellIds'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){
  if(!input||Object.keys(input).some(k=>k!=='cellIds')||!Array.isArray(input.cellIds)||!input.cellIds.length||input.cellIds.length>140||new Set(input.cellIds).size!==input.cellIds.length||input.cellIds.some(id=>!Number.isInteger(id)||id<1||id>140))throw new Error('cellIds must contain unique integers from 1 to 140.');
  return {source:mode,stale:Date.now()-frame.timestampMs>STALE_MS,timestampMs:frame.timestampMs,socPct:frame.socPct,packVoltageV:stats(frame).pack,cells:frame.cells.filter(c=>input.cellIds.includes(c.id)).map(c=>({...c}))};
 }};
 try{Promise.resolve(document.modelContext.registerTool(readTool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
