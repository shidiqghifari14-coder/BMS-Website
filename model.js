import {MODULE_LABELS} from './stm-log.js';
export const CELL_COUNT=140;
export const STALE_MS=5000;
export const numeric=(v,min=-Infinity,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const optionalNumber=(v,min,max)=>v===null||numeric(v,min,max);
const states=['normal','warning','fault','unknown'];
export function validateFrame(data,now=Date.now()){
  if(!data||!['arjuna.bms.v1','arjuna.bms.v2'].includes(data.schema))throw new Error('Versi telemetry harus arjuna.bms.v1 atau v2.');
  const v2=data.schema==='arjuna.bms.v2';
  if(v2&&(!Number.isSafeInteger(data.sequence)||data.sequence<0||typeof data.sourceSessionId!=='string'||data.sourceSessionId.length>100))throw new Error('v2 memerlukan sequence dan sourceSessionId.');
  if(!numeric(data.timestampMs,0)||data.timestampMs>now+2000||now-data.timestampMs>STALE_MS)throw new Error('Timestamp telemetry kedaluwarsa atau tidak sinkron.');
  if(!Array.isArray(data.cells)||data.cells.length!==CELL_COUNT)throw new Error('Telemetry wajib memuat tepat 140 sel.');
  const ids=new Set();
  for(const c of data.cells){
    if(!c||!Number.isInteger(c.id)||c.id<1||c.id>140||ids.has(c.id))throw new Error('ID sel harus unik: 1–140.');
    ids.add(c.id);
    if(!optionalNumber(c.voltageV,0,10)||!(typeof c.balancing==='boolean'||v2&&c.balancing===null)||!states.includes(c.status))throw new Error('Format data sel tidak valid.');
  }
  for(const [key,min,max] of [['currentA',-10000,10000],['socPct',0,100],['sohPct',0,100],['remainingKwh',0,100000],['capacityAh',0,100000],['cycles',0,10000000]]){
    if(!optionalNumber(data[key],min,max))throw new Error(`Field ${key} tidak valid; gunakan null bila belum tersedia.`);
  }
  if(!Array.isArray(data.temperatures)||data.temperatures.length>1000||data.temperatures.some(t=>!t||!Number.isInteger(t.id)||t.id<1||!optionalNumber(t.celsius,-100,300)||!states.includes(t.status))||new Set(data.temperatures.map(t=>t.id)).size!==data.temperatures.length)throw new Error('Format temperatur tidak valid.');
  if(!Array.isArray(data.faults)||data.faults.length>100||data.faults.some(f=>!f||typeof f.code!=='string'||f.code.length>80||typeof f.message!=='string'||f.message.length>300||!['warning','fault'].includes(f.severity)))throw new Error('Format fault tidak valid.');
  if(!data.system||!['open','closed','unknown'].includes(data.system.contactor)||!['ok','open','unknown'].includes(data.system.interlock)||!['ok','fault','unknown'].includes(data.system.isolation)||!optionalNumber(data.system.canErrorCount,0,1e9)||!optionalNumber(data.system.pecErrorCount,0,1e9))throw new Error('Format status sistem tidak valid.');
  if(v2){
    if(!Array.isArray(data.modules)||data.modules.length!==10||new Set(data.modules.map(m=>m?.id)).size!==10||data.modules.some(m=>!m||!Number.isInteger(m.id)||m.id<1||m.id>10||typeof m.installed!=='boolean'||typeof m.label!=='string'||m.label.length>30))throw new Error('v2 memerlukan 10 slot modul.');
    const channels=new Set();
    for(const t of data.temperatures){if(!Number.isInteger(t.moduleId)||t.moduleId<1||t.moduleId>10||!Number.isInteger(t.channel)||t.channel<1||t.channel>24||channels.has(t.moduleId+':'+t.channel))throw new Error('Mapping temperatur harus unik: 10 modul × 24 kanal.');channels.add(t.moduleId+':'+t.channel);}
    if(data.temperatures.length!==240)throw new Error('v2 memerlukan 240 slot temperatur; gunakan null untuk kanal tidak tersedia.');
    if(data.timestampBasis!=null&&!['device_utc','host_receive'].includes(data.timestampBasis))throw new Error('timestampBasis tidak valid.');
    if(data.localVoltageMv!=null&&(!Array.isArray(data.localVoltageMv)||data.localVoltageMv.length!==48||data.localVoltageMv.some(v=>!optionalNumber(v,0,10000))))throw new Error('Tegangan lokal tidak valid.');
  }
  return structuredClone({...data,cells:[...data.cells].sort((a,b)=>a.id-b.id)});
}
export function stats(frame){
  const cells=frame.cells.filter(c=>numeric(c.voltageV,0,10));
  const low=cells.length?cells.reduce((a,b)=>a.voltageV<b.voltageV?a:b):null;
  const high=cells.length?cells.reduce((a,b)=>a.voltageV>b.voltageV?a:b):null;
  const sum=cells.reduce((s,c)=>s+c.voltageV,0);
  const pack=cells.length===CELL_COUNT?sum:null;
  const temps=frame.temperatures.filter(t=>numeric(t.celsius));
  return {valid:cells.length,low,high,delta:low?(high.voltageV-low.voltageV)*1000:null,average:cells.length?sum/cells.length:null,pack,power:pack!==null&&frame.currentA!==null?pack*frame.currentA/1000:null,maxTemp:temps.length?Math.max(...temps.map(t=>t.celsius)):null,minTemp:temps.length?Math.min(...temps.map(t=>t.celsius)):null,balancing:cells.filter(c=>c.balancing).length};
}
export function makeDemo(tick=0,scenario='drive',now=Date.now()){
  const cells=Array.from({length:CELL_COUNT},(_,i)=>({id:i+1,voltageV:Number((3.891+Math.sin(i*2.17)*.011+Math.cos(i*.71)*.007+Math.sin(tick/12)*.002).toFixed(3)),balancing:scenario==='balance'&&i%17===0,status:'normal'}));
  if(scenario==='imbalance'){cells[86].voltageV=3.742;cells[86].status='warning';}
  const temperatures=Array.from({length:240},(_,i)=>({id:i+1,moduleId:Math.floor(i/24)+1,channel:i%24+1,celsius:i<192?Number((30.2+Math.sin(i*.68)*2.1+Math.sin(tick/9)*.3).toFixed(1)):null,status:i<192?'normal':'unknown',sampleTimestampMs:i<192?now:null}));
  if(scenario==='thermal'){temperatures[12].celsius=52.4;temperatures[12].status='fault';}
  const currentA=scenario==='thermal'?0:scenario==='balance'?-8.4:Number((32.4+Math.sin(tick/6)*7+Math.sin(tick/2)*2).toFixed(1));
  return {schema:'arjuna.bms.v2',sequence:Math.max(0,Math.round(tick*1000)),sourceSessionId:'demo',timestampBasis:'device_utc',modules:MODULE_LABELS.map((label,i)=>({id:i+1,label,installed:i<8})),timestampMs:now,cells,temperatures,currentA,socPct:Number((78.4+Math.sin(tick/90)*.2).toFixed(1)),sohPct:98.2,remainingKwh:8.62,capacityAh:20.2,cycles:42,
    faults:scenario==='imbalance'?[{code:'DEMO_CELL_DELTA',severity:'warning',message:'Simulasi deviasi tegangan pada sel C087.'}]:scenario==='thermal'?[{code:'DEMO_OVER_TEMP',severity:'fault',message:'Simulasi temperatur tinggi pada sensor T13.'}]:[],
    system:{contactor:scenario==='thermal'?'open':'closed',interlock:'ok',isolation:'ok',canErrorCount:0,pecErrorCount:0}};
}
export function toCsv(frame,mode,stale){
  const s=stats(frame);
  const esc=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[['source','data_state','timestamp_utc','cell_id','voltage_V','deviation_mV','balancing','firmware_status']];
  for(const c of frame.cells)rows.push([mode,stale?'stale':'fresh',new Date(frame.timestampMs).toISOString(),c.id,c.voltageV,c.voltageV===null||s.average===null?'':((c.voltageV-s.average)*1000).toFixed(1),stale?null:c.balancing,stale?'stale':c.status]);
  return rows.map(row=>row.map(esc).join(',')).join('\r\n');
}
