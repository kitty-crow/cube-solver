const DB_NAME="picture-cube-reference-session";
const DB_VERSION=1;
const STORE="sessions";

export function referenceFingerprint(payload){
  const text=`${payload?.size||3}:${payload?.tile_size||0}:${payload?.rgb_b64||""}`;
  let hash=0x811c9dc5;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,0x01000193);
  }
  return(hash>>>0).toString(16);
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"key"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Could not open reference-session storage"));
  });
}

function txDone(tx){
  return new Promise((resolve,reject)=>{
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error("Reference-session transaction failed"));
    tx.onabort=()=>reject(tx.error||new Error("Reference-session transaction aborted"));
  });
}

function requestValue(request,fallback=null){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result??fallback);
    request.onerror=()=>reject(request.error||new Error("Reference-session request failed"));
  });
}

async function fetchReferenceBlob(url){
  if(!url)return null;
  try{
    const response=await fetch(url,{mode:url.startsWith("data:")||url.startsWith("blob:")?"same-origin":"cors"});
    if(!response.ok&&!url.startsWith("data:")&&!url.startsWith("blob:"))return null;
    return await response.blob();
  }catch(_){return null;}
}

function cloneCandidate(candidate){
  if(!candidate)return null;
  const copy=structuredClone(candidate);
  // Blob URLs die with the browsing document. The actual image bytes are stored
  // separately in IndexedDB and a fresh object URL is created on restore.
  if(String(copy.thumbnailUrl||"").startsWith("blob:"))copy.thumbnailUrl="";
  return copy;
}

async function readCurrent(db){
  const tx=db.transaction(STORE,"readonly");
  const record=await requestValue(tx.objectStore(STORE).get("current"),null);
  await txDone(tx);
  return record;
}

export async function saveReferenceSession({payload,result,selectedIndex,candidate,draft=null,editorState=null}){
  if(!payload||!candidate)return false;
  let db;
  try{
    db=await openDb();
    const fingerprint=referenceFingerprint(payload);

    // Do not keep a read/write IndexedDB transaction open across a network
    // fetch. Browsers are allowed to auto-commit an idle transaction while the
    // fetch is pending, which previously made autosaves intermittently vanish
    // with TransactionInactiveError on reload.
    const existing=await readCurrent(db).catch(()=>null);
    const candidateCopy=cloneCandidate(candidate);
    const remoteThumbnail=String(candidate?.thumbnailUrl||candidate?.sourceUrl||"");
    let referenceBlob=existing?.fingerprint===fingerprint?existing.referenceBlob:null;
    if(!referenceBlob)referenceBlob=await fetchReferenceBlob(remoteThumbnail);

    const record={
      key:"current",
      version:2,
      fingerprint,
      size:Number(payload.size||0),
      subject:String(result?.subject||""),
      guesses:structuredClone(result?.guesses||[]),
      faceRecognitions:structuredClone(result?.faceRecognitions||[]),
      model:structuredClone(result?.model||null),
      selectedIndex:Number.isInteger(selectedIndex)?selectedIndex:0,
      candidate:candidateCopy,
      remoteThumbnail:remoteThumbnail.startsWith("blob:")?String(existing?.remoteThumbnail||""):remoteThumbnail,
      referenceBlob:referenceBlob||null,
      draft:structuredClone(draft||null),
      editorState:structuredClone(editorState||null),
      savedAt:Date.now(),
    };

    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(record);
    await txDone(tx);
    return true;
  }finally{db?.close?.();}
}

export async function loadReferenceSession(payload){
  if(!payload)return null;
  let db;
  try{
    db=await openDb();
    const record=await readCurrent(db);
    if(!record||record.fingerprint!==referenceFingerprint(payload)||Number(record.size)!==Number(payload.size))return null;
    return record;
  }finally{db?.close?.();}
}

export async function clearReferenceSession(){
  let db;
  try{
    db=await openDb();
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  }catch(_){
  }finally{db?.close?.();}
}
