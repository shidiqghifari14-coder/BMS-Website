import {CSV_HEADER,csvRow} from './log-format.js';
const PART_BYTES=16*1024*1024,MAX_BYTES=512*1024*1024;
let db,session=null,pending=[],pendingBytes=0,chunkIndex=0,queue=Promise.resolve();
const openDB=()=>new Promise((resolve,reject)=>{const req=indexedDB.open('arjuna-bms-logs-v2',1);req.onupgradeneeded=()=>{const d=req.result;d.createObjectStore('sessions',{keyPath:'id'});const c=d.createObjectStore('chunks',{keyPath:['sessionId','index']});c.createIndex('session','sessionId');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Penyimpanan dibatalkan.'));});
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
async function ensure(){db??=await openDB();}
function update(){postMessage({type:'state',session:session?{...session,pending:pending.length}:null});}
async function flush(){if(!session||!pending.length)return;
  const chunk={sessionId:session.id,index:chunkIndex++,part:session.parts-1,text:pending.join(''),rows:pending.length};
  const bytes=pendingBytes,rowsBeforeFlush=pending;pending=[];pendingBytes=0;
  const previous={...session};session.savedRows+=chunk.rows;session.savedBytes+=bytes;
  const tx=db.transaction(['sessions','chunks'],'readwrite');tx.objectStore('chunks').put(chunk);tx.objectStore('sessions').put(session);
  try{await done(tx);}catch(error){session=previous;pending=rowsBeforeFlush;pendingBytes=bytes;throw error;}
  update();
}
async function handle(m){await ensure();
 if(m.type==='start'){
   if(session?.active)throw new Error('Sesi perekaman masih aktif.');
   session={id:crypto.randomUUID(),source:m.source,name:String(m.name||'BMS session').slice(0,100),startedMs:Date.now(),endedMs:null,active:true,savedRows:0,savedBytes:0,parts:1,partBytes:0,error:null};pending=[];pendingBytes=0;chunkIndex=0;
   const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(session);await done(tx);update();return session;
 }
 if(m.type==='frames'){
   if(!session?.active)throw new Error('Perekaman tidak aktif.');
   for(const item of m.frames){
     const row=csvRow(item.frame,session.source,item.receivedMs);const bytes=new TextEncoder().encode(row).byteLength;
     if(session.savedBytes+pendingBytes+bytes>MAX_BYTES){await flush();session.active=false;session.error='Batas sesi 512 MiB tercapai. Mulai sesi baru untuk melanjutkan.';session.endedMs=Date.now();await saveSession();update();break;}
     if(session.partBytes+bytes>PART_BYTES){await flush();session.parts++;session.partBytes=0;}
     pending.push(row);pendingBytes+=bytes;session.partBytes+=bytes;
     if(pendingBytes>=256*1024)await flush();
   }
   return {received:m.frames.length};
 }
 if(m.type==='flush'){await flush();return session;}
 if(m.type==='stop'){
   if(session){await flush();session.active=false;session.endedMs=Date.now();if(m.reason)session.error=m.reason;await saveSession();update();}return session;
 }
 if(m.type==='list'){
   const tx=db.transaction('sessions');const all=await request(tx.objectStore('sessions').getAll());return all.sort((a,b)=>b.startedMs-a.startedMs);
 }
 if(m.type==='export'){
   if(session?.id===m.sessionId)await flush();
   const tx=db.transaction(['chunks','sessions']);const meta=await request(tx.objectStore('sessions').get(m.sessionId));
   if(!meta)throw new Error('Sesi tidak ditemukan.');
   const read=db.transaction('chunks');const rows=[];
   await new Promise((resolve,reject)=>{const cursor=read.objectStore('chunks').index('session').openCursor(IDBKeyRange.only(m.sessionId));cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const c=cursor.result;if(!c){resolve();return;}if(c.value.part===m.part)rows.push(c.value.text);c.continue();};});
   return {text:'\uFEFF'+CSV_HEADER+rows.join(''),meta};
 }
 throw new Error('Perintah logger tidak dikenal.');
}
async function saveSession(){const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(session);await done(tx);}
onmessage=({data})=>{
 queue=queue.then(async()=>{try{const result=await handle(data);postMessage({type:'reply',id:data.id,result});}
 catch(error){if(session){session.active=false;session.error=String(error.message||error);session.endedMs=Date.now();try{await saveSession();}catch{}update();}postMessage({type:'reply',id:data.id,error:String(error.message||error)});}});
};
