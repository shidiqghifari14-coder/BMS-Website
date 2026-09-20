export class Recorder {
  constructor(onChange=()=>{}){
    this.worker=new Worker(new URL('./logger-worker.js',import.meta.url),{type:'module'});
    this.requests=new Map();this.nextId=0;this.active=false;this.session=null;this.inFlight=0;this.onChange=onChange;this.failure=null;
    this.worker.onmessage=({data:m})=>{if(m.type==='state'){this.session=m.session;this.active=!!m.session?.active;this.onChange();return;}const req=this.requests.get(m.id);if(req){this.requests.delete(m.id);m.error?req.reject(new Error(m.error)):req.resolve(m.result);}};
    this.worker.onerror=e=>{this.active=false;this.failure=e.message||'Worker logging berhenti.';for(const r of this.requests.values())r.reject(new Error(this.failure));this.requests.clear();this.onChange();};
    this.timer=setInterval(()=>{if(this.active)this.call('flush').catch(e=>this.fail(e));},1000);
  }
  call(type,fields={}){return new Promise((resolve,reject)=>{const id=++this.nextId;this.requests.set(id,{resolve,reject});this.worker.postMessage({type,id,...fields});});}
  async start(source,name){this.failure=null;this.session=await this.call('start',{source,name});this.active=true;this.onChange();}
  push(frame,receivedMs){if(!this.active)return;
    if(this.inFlight>=200){this.active=false;this.failure='Antrean logger penuh. Perekaman dihentikan; sampel setelah antrean penuh tidak tersimpan.';this.call('stop',{reason:this.failure}).catch(()=>{});this.onChange();return;}
    this.inFlight++;this.call('frames',{frames:[{frame,receivedMs}]}).catch(e=>this.fail(e)).finally(()=>{this.inFlight--;});
  }
  fail(error){this.failure=error.message;this.active=false;this.onChange();}
  async stop(reason){this.active=false;this.session=await this.call('stop',{reason});this.onChange();return this.session;}
  list(){return this.call('list');}
  export(id,part=0){return this.call('export',{sessionId:id,part});}
}
