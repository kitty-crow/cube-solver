const DB_NAME="picture-cube-solver-reference-session";
const DB_VERSION=1;
const STORE="sessions";
const MAX_SESSIONS=4;

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(new Error("IndexedDB unavailable"));
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"key"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Could not open reference-session storage"));
  });
}

export function referenceSessionKey(payload){
  const text=`${payload?.size||0}:${payload?.tile_size||0}:${payload?.rounded_cubies?1:0}:${payload?.rgb_b64||""}`;
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);h1^=c;h1=Math.imul(h1,0x01000193);h2^=c+i;h2=Math.imul(h2,0x85ebca6b);
  }
  return`${(h1>>>0).toString(16)}${(h2>>>0).toString(16)}`;
}

export async function loadReferenceSession(payload){
  let db;
  try{
    db=await openDb();
    const key=referenceSessionKey(payload),tx=db.transaction(STORE,"readonly");
    return await new Promise((resolve,reject)=>{
      const request=tx.objectStore(STORE).get(key);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error("Could not restore reference session"));
    });
  }catch(error){
    console.warn("Reference session restore unavailable",error);return null;
  }finally{db?.close?.();}
}

export async function saveReferenceSession(payload,state){
  if(!payload||!state)return false;
  let db;
  try{
    db=await openDb();
    const key=referenceSessionKey(payload),tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE);
    store.put({...state,key,size:Number(payload.size||0),savedAt:Date.now()});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Could not save reference session"));tx.onabort=()=>reject(tx.error||new Error("Could not save reference session"));});

    const cleanup=db.transaction(STORE,"readwrite"),cleanupStore=cleanup.objectStore(STORE),all=await new Promise((resolve,reject)=>{const request=cleanupStore.getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});
    all.sort((a,b)=>Number(b.savedAt||0)-Number(a.savedAt||0));
    for(const item of all.slice(MAX_SESSIONS))cleanupStore.delete(item.key);
    return true;
  }catch(error){console.warn("Could not persist reference session",error);return false;}
  finally{db?.close?.();}
}

export async function fetchReferenceBlob(url){
  if(!url)return null;
  try{
    const response=await fetch(url,{mode:"cors"});
    if(!response.ok)return null;
    return await response.blob();
  }catch(_){return null;}
}

export function blobToDataUrl(blob){
  if(!blob)return Promise.resolve(null);
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("Could not restore cached reference image"));
    reader.readAsDataURL(blob);
  });
}
