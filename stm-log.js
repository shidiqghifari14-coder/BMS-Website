// Format observed in InterfaceJOSJIS/Core/Src/main.c:1430–1582.
// A frame is emitted only after a complete current + four voltage + eight thermal sections.
export const MODULE_LABELS = ['1A','2A','3A','4A','1B','2B','3B','4B','M09','M10'];
export function emptyFrame(now = Date.now()) {
  return {
    schema:'arjuna.bms.v2', timestampMs:now, sequence:0, acquisitionTimestampMs:null,
    timestampBasis:'host_receive', quality:'legacy-unverified', sourceSessionId:'stm-uart',
    cells:Array.from({length:140},(_,i)=>({id:i+1,voltageV:null,balancing:null,status:'unknown'})),
    temperatures:Array.from({length:240},(_,i)=>({id:i+1,moduleId:Math.floor(i/24)+1,channel:i%24+1,celsius:null,rawValue:null,status:'unknown',sampleTimestampMs:null})),
    modules:MODULE_LABELS.map((label,i)=>({id:i+1,label,installed:i<8})),
    currentA:null,rawCurrentA:null,socPct:null,sohPct:null,remainingKwh:null,capacityAh:null,cycles:null,
    faults:[],system:{contactor:'unknown',interlock:'unknown',isolation:'unknown',canErrorCount:null,pecErrorCount:null},
    localVoltageMv:Array(48).fill(null),voltageMapping:'unmapped'
  };
}
export class StmLogParser {
  constructor({mapLocalCells=false,onFrame,onReject=()=>{}}={}) {
    this.mapLocalCells=mapLocalCells;this.onFrame=onFrame;this.onReject=onReject;
    this.buffer='';this.cycle=null;this.section=null;this.sequence=0;
    this.sessionId='stm-'+Date.now();
  }
  push(text,now=Date.now()) {
    this.buffer+=text;
    if(this.buffer.length>65536){this.buffer='';this.cycle=null;this.section=null;this.onReject('UART buffer melebihi batas; sinkronisasi ulang.');return;}
    let end;
    while((end=this.buffer.indexOf('\n'))!==-1){const line=this.buffer.slice(0,end).replaceAll('\r','').trim();this.buffer=this.buffer.slice(end+1);this.line(line,now);}
  }
  line(line,now) {
    const current=line.match(/^Current\s*:\s*(-?\d+(?:\.\d+)?)$/);
    if(current){if(this.cycle)this.onReject('Siklus UART tidak lengkap.');this.cycle={current:Number(current[1]),volts:new Map(),temps:new Map()};this.section=null;return;}
    if(!this.cycle)return;
    const voltage=line.match(/^VOLTAGE --- ([1-4]A)$/);
    const temperature=line.match(/^(?:--)?TEMP DATA --- ([1-4][AB])$/);
    if(voltage||temperature){this.section={kind:voltage?'volts':'temps',label:(voltage||temperature)[1]};return;}
    if(!this.section||!line)return;
    const {kind,label}=this.section;let values;
    if(kind==='volts') {
      if(!/^[@\d,\s#]+$/.test(line))return this.reject('Baris tegangan UART rusak.');
      values=line.match(/\d+/g)?.map(Number)??[];
      if(values.length!==12||values.some(v=>v>10000))return this.reject('Tegangan harus 12 kanal mV per blok.');
    } else {
      if(!/^[\d\s\-#]+$/.test(line))return this.reject('Baris temperatur UART rusak.');
      values=line.match(/\d+/g)?.map(Number)??[];
      if(values.length!==24||values.some(v=>v>255))return this.reject('Temperatur harus 24 byte per modul.');
    }
    if(this.cycle[kind].has(label))return this.reject('Blok UART duplikat.');
    this.cycle[kind].set(label,values);this.section=null;
    if(kind==='temps'&&label==='4B') {
      if(!line.endsWith('#')||this.cycle.volts.size!==4||this.cycle.temps.size!==8)return this.reject('Siklus UART tidak lengkap.');
      const f=emptyFrame(now);f.sequence=++this.sequence;f.sourceSessionId=this.sessionId;
      f.rawCurrentA=this.cycle.current;
      // STM defines negative discharge / positive charge. HMI convention is the reverse.
      f.currentA=-this.cycle.current;
      f.localVoltageMv=MODULE_LABELS.slice(0,4).flatMap(l=>this.cycle.volts.get(l));
      if(this.mapLocalCells){f.voltageMapping='interface_A_to_C001_C048';f.cells.forEach((c,i)=>{if(i<48)c.voltageV=f.localVoltageMv[i]/1000;});}
      f.temperatures.forEach((t,i)=>{if(i<192){const raw=this.cycle.temps.get(MODULE_LABELS[t.moduleId-1])[t.channel-1];t.rawValue=raw;t.celsius=raw;}});
      this.cycle=null;this.onFrame?.(f);
    }
  }
  reject(message){this.cycle=null;this.section=null;this.onReject(message);}
}
