const DB_NAME="picture-cube-solver-runtime";
const DB_VERSION=2;
const STORE="reference";
const FACE_NAMES=["U","R","F","D","L","B"];
const DISPLAY_ORDER=["F","R","B","L","U","D"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};

function installStyles(){
  if(document.querySelector("#solution-target-styles"))return;
  const style=document.createElement("style");
  style.id="solution-target-styles";
  style.textContent=`
    .solution-target { display:grid; gap:.65rem; padding:.85rem; border:1px solid var(--app-border); border-radius:1rem; }
    .solution-target[hidden] { display:none; }
    .solution-target__head { display:flex; gap:1rem; justify-content:space-between; align-items:baseline; }
    .solution-target__head h3 { margin:0; font-size:1rem; }
    .solution-target__head p { margin:0; font-size:.72rem; opacity:.68; text-align:right; }
    .solution-target__faces { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:.45rem; }
    .solution-target__face { min-width:0; margin:0; display:grid; gap:.2rem; }
    .solution-target__face img { display:block; width:100%; aspect-ratio:1; object-fit:cover; border:1px solid var(--app-border); border-radius:.55rem; }
    .solution-target__face figcaption { text-align:center; font-size:.64rem; opacity:.72; }
    @media (max-width:700px) { .solution-target__faces { grid-template-columns:repeat(3,minmax(0,1fr)); } .solution-target__head { display:grid; } .solution-target__head p { text-align:left; } }
  `;
  document.head.appendChild(style);
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return resolve(null);
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains("evidence"))db.createObjectStore("evidence",{keyPath:"key"});
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"key"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Could not open solved-target storage"));
  });
}

async function loadReference(){
  const db=await openDb();if(!db)return null;
  try{
    if(!db.objectStoreNames.contains(STORE))return null;
    const tx=db.transaction(STORE,"readonly"),request=tx.objectStore(STORE).get("current");
    return await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result?.evidence||null);request.onerror=()=>reject(request.error||new Error("Could not read solved target"));});
  }finally{db.close();}
}

function ensurePanel(){
  installStyles();
  const result=document.querySelector("#result-panel");if(!result)return null;
  let panel=result.querySelector("[data-solved-target]");
  if(panel)return panel;
  panel=document.createElement("section");
  panel.className="solution-target";
  panel.dataset.solvedTarget="";
  panel.hidden=true;
  panel.innerHTML=`<div class="solution-target__head"><h3>This is what the solved cube should look like</h3><p data-solved-target-note></p></div><div class="solution-target__faces" data-solved-target-faces></div>`;
  const grid=result.querySelector(".result-grid");
  if(grid)grid.insertAdjacentElement("beforebegin",panel);else result.appendChild(panel);
  return panel;
}

async function render(){
  const result=document.querySelector("#result-panel"),panel=ensurePanel();if(!result||!panel||result.hidden){if(panel)panel.hidden=true;return;}
  const evidence=await loadReference().catch(error=>{console.warn("Could not load solved target",error);return null;});
  const ref=evidence?.reference||{},previews=Array.isArray(ref.solved_face_previews)?ref.solved_face_previews:[];
  if(previews.length!==6){panel.hidden=true;return;}
  const order=Array.isArray(ref.face_order)&&ref.face_order.length===6?ref.face_order:FACE_NAMES;
  const byFace=new Map(order.map((face,index)=>[face,previews[index]]));
  const faces=panel.querySelector("[data-solved-target-faces]");faces.textContent="";
  for(const face of DISPLAY_ORDER){
    const src=byFace.get(face);if(!src)continue;
    const figure=document.createElement("figure");figure.className="solution-target__face";
    const img=document.createElement("img");img.src=src;img.alt=`Solved target ${FACE_LABELS[face]} face`;
    const caption=document.createElement("figcaption");caption.textContent=`${FACE_LABELS[face]} · ${face}`;
    figure.append(img,caption);faces.appendChild(figure);
  }
  const topology=ref.topology?.kind||ref.surface_partition||"connected cube surface";
  const note=panel.querySelector("[data-solved-target-note]");
  note.textContent=`The move sequence is solving the scanned pieces toward this exact wrapped reference · ${String(topology).replaceAll("-"," ")}`;
  panel.hidden=false;
}

const result=document.querySelector("#result-panel");
if(result){
  new MutationObserver(()=>render()).observe(result,{attributes:true,attributeFilter:["hidden"]});
  window.addEventListener("picture-reference-ready",()=>{if(!result.hidden)render();});
  render();
}
