import {StmLogParser} from './stm-log.js';
export class TelemetrySource {
  constructor({onFrame,onError,onStatus}){Object.assign(this,{onFrame,onError,onStatus});this.epoch=0;this.abort=null;this.reader=null;this.port=null;}
  async disconnect(){this.epoch++;this.abort?.abort();this.abort=null;const reader=this.reader;this.reader=null;try{await reader?.cancel();}catch{}const port=this.port;this.port=null;try{await port?.close();}catch{} }
  async serial(mapLocalCells=false){
    if(!navigator.serial)throw new Error('Web Serial tidak tersedia. Buka dashboard di Chrome/Edge desktop melalui HTTPS atau localhost.');
    // requestPort must be called directly from the operator's click.
    const chosen=await navigator.serial.requestPort();
    await this.disconnect();this.port=chosen;
    await chosen.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:65536});
    const epoch=this.epoch,parser=new StmLogParser({mapLocalCells,onFrame:f=>this.onFrame(f,'serial'),onReject:m=>this.onError(m)});
    this.onStatus('serial','Menunggu satu siklus log STM lengkap.');
    const reader=chosen.readable.getReader();this.reader=reader;const decoder=new TextDecoder();
    this.running=(async()=>{try{while(epoch===this.epoch){const {value,done}=await reader.read();if(done||epoch!==this.epoch)break;parser.push(decoder.decode(value,{stream:true}));}}
      catch(e){if(epoch===this.epoch)this.onError(e.message);}
      finally{reader.releaseLock();if(this.reader===reader)this.reader=null;if(epoch===this.epoch)this.onStatus('ended','USB serial terputus.');}})();
  }
  async network(url,token,kind,interval=1000){
    const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Gunakan URL HTTP(S) tanpa credential di URL.');
    if(location.protocol==='https:'&&parsed.protocol==='http:')throw new Error('Gateway HTTP lokal perlu dashboard lokal. Situs HTTPS memerlukan gateway HTTPS.');
    await this.disconnect();const epoch=this.epoch;this.abort=new AbortController();
    const options={headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',credentials:'omit',redirect:'error'};
    this.onStatus(kind,'Menunggu telemetry gateway.');
    if(kind==='poll'){
      const poll=async()=>{if(epoch!==this.epoch)return;const start=performance.now();
        try{const resp=await fetch(url,{...options,signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(3000)])});if(!resp.ok)throw new Error(`Gateway HTTP ${resp.status}`);const txt=await resp.text();if(txt.length>2_000_000)throw new Error('Payload melebihi 2 MB.');const data=JSON.parse(txt);const frames=Array.isArray(data)?data:[data];if(frames.length>200)throw new Error('Maksimal 200 frame per batch.');if(epoch===this.epoch)for(const f of frames)this.onFrame(f,'poll');}
        catch(e){if(epoch===this.epoch)this.onError(e.message);}
        if(epoch===this.epoch)setTimeout(poll,Math.max(0,interval-(performance.now()-start)));
      };this.running=poll();return;
    }
    const resp=await fetch(url,{...options,signal:this.abort.signal});if(!resp.ok)throw new Error(`Gateway HTTP ${resp.status}`);if(!resp.body)throw new Error('Stream kosong.');
    const reader=resp.body.getReader();this.reader=reader;const decoder=new TextDecoder();let buffer='';
    this.running=(async()=>{try{while(epoch===this.epoch){const {value,done}=await reader.read();if(done||epoch!==this.epoch)break;buffer+=decoder.decode(value,{stream:true});let end;
      while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;if(line.length>250000)throw new Error('Frame stream melebihi batas.');try{this.onFrame(JSON.parse(line),'stream');}catch(e){this.onError(e.message);}}
      if(buffer.length>250000)throw new Error('Baris stream melebihi batas.');
    }}catch(e){if(epoch===this.epoch)this.onError(e.message);}finally{reader.releaseLock();if(this.reader===reader)this.reader=null;if(epoch===this.epoch)this.onStatus('ended','Stream gateway terputus.');}})();
  }
}
