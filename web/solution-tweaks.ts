import * as THREE from "three";
import {
  analyseStickerConstraints,
  CENTRE_FACELETS,
  EDGE_FACELETS,
  CORNER_FACELETS,
  labelForFacelet,
} from "./sticker-constraints-v3.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const NORMAL={U:new THREE.Vector3(0,1,0),R:new THREE.Vector3(1,0,0),F:new THREE.Vector3(0,0,1),D:new THREE.Vector3(0,-1,0),L:new THREE.Vector3(-1,0,0),B:new THREE.Vector3(0,0,-1)};
const RIGHT={U:new THREE.Vector3(1,0,0),R:new THREE.Vector3(0,0,-1),F:new THREE.Vector3(1,0,0),D:new THREE.Vector3(1,0,0),L:new THREE.Vector3(0,0,1),B:new THREE.Vector3(-1,0,0)};
const UP={U:new THREE.Vector3(0,0,-1),R:new THREE.Vector3(0,1,0),F:new THREE.Vector3(0,1,0),D:new THREE.Vector3(0,0,1),L:new THREE.Vector3(0,1,0),B:new THREE.Vector3(0,1,0)};
const CENTRES=new Set(CENTRE_FACELETS.map(Number));
const EDGES=new Set(EDGE_FACELETS.flat().map(Number));
const CORNERS=new Set(CORNER_FACELETS.flat().map(Number));
const MODE_SETTING="picture-cube-mode";
const DB_NAME="picture-cube-solver-runtime";
const DB_VERSION=2;

const state={
  root:null,view:null,selectedTile:null,selectedPhoto:null,draftTarget:null,draftRotation:0,
  tweaks:new Map(),centerRotations:[0,0,0,0,0,0],analysis:null,referenceFaces:new Map(),
  busy:false,playback:null,playbackIndex:0,playing:false,pointerStart:null,
};

const uiToGeometry=q=>(4-(((Number(q)||0)%4+4)%4))%4;
const mod4=value=>((Number(value)||0)%4+4)%4;

function isPicture3x3(){
  const solid=window.pictureCubeMode?.isSolidColour?.()||localStorage.getItem(MODE_SETTING)==="solid-colour";
  return !solid&&Number(document.querySelector("#cube-size")?.value||3)===3;
}
function isSolvedVisual(){
  const panel=document.querySelector("#result-panel"),text=String(document.querySelector("#move-text")?.textContent||"").trim();
  return Boolean(panel&&!panel.hidden&&/^Solved\b/i.test(text));
}
function kindOf(tile){if(CENTRES.has(tile))return"centre";if(EDGES.has(tile))return"edge";if(CORNERS.has(tile))return"corner";return"unknown";}
function pieceTiles(tile){
  if(CENTRES.has(tile))return[tile];
  for(const piece of EDGE_FACELETS)if(piece.includes(tile))return piece.map(Number);
  for(const piece of CORNER_FACELETS)if(piece.includes(tile))return piece.map(Number);
  return[];
}
function candidateTargets(tile){
  const kind=kindOf(tile);if(kind==="centre")return[tile];
  const source=kind==="edge"?EDGES:kind==="corner"?CORNERS:new Set();
  return[...source].sort((a,b)=>a-b);
}
function releasePiece(set,tile){for(const value of pieceTiles(tile))set.add(Number(value));}

function analyseTarget(){
  const released=new Set();
  for(const[tile,tweak]of state.tweaks){releasePiece(released,Number(tile));releasePiece(released,Number(tweak.target));}
  const confirmations={};
  for(let tile=0;tile<54;tile++){
    if(CENTRES.has(tile)||released.has(tile))continue;
    confirmations[tile]={target:tile,rotation:0};
  }
  for(const[tile,tweak]of state.tweaks)confirmations[tile]={target:Number(tweak.target),rotation:uiToGeometry(tweak.rotation)};
  state.analysis=analyseStickerConstraints({confirmations,ambiguities:{},centerRotations:state.centerRotations});
  return state.analysis;
}

function installStyles(){
  if(document.querySelector("#solution-tweaks-styles"))return;
  const style=document.createElement("style");style.id="solution-tweaks-styles";
  style.textContent=`
    .solution-tweak-modal{position:fixed;inset:0;z-index:1600;background:rgba(3,8,8,.78);display:grid;place-items:center;padding:max(.7rem,env(safe-area-inset-top)) max(.7rem,env(safe-area-inset-right)) max(.7rem,env(safe-area-inset-bottom)) max(.7rem,env(safe-area-inset-left));backdrop-filter:blur(8px)}
    .solution-tweak-modal[hidden]{display:none}
    .solution-tweak-card{width:min(46rem,100%);max-height:94dvh;overflow:auto;background:var(--app-panel,#0d1916);border:1px solid var(--app-border);border-radius:1.25rem;padding:.8rem;display:grid;gap:.75rem;box-shadow:0 1.2rem 4rem rgba(0,0,0,.35)}
    .solution-tweak-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.5rem}.solution-tweak-head h2{margin:0;font-size:1.05rem}.solution-tweak-close{width:2rem!important;min-width:2rem!important;height:2rem;padding:0!important;border-radius:999px!important;font-size:1.25rem!important;display:grid!important;place-items:center!important}
    .solution-tweak-compare{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.solution-tweak-preview{margin:0;display:grid;gap:.3rem;min-width:0}.solution-tweak-preview__box{width:100%;aspect-ratio:1;border:1px solid var(--app-border);border-radius:.8rem;background:#07110f center/cover no-repeat;overflow:hidden}.solution-tweak-preview__box img{width:100%;height:100%;object-fit:cover;display:block}.solution-tweak-preview figcaption{text-align:center;font-size:.7rem;opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .solution-tweak-controls{display:grid;gap:.55rem;padding:.65rem;border:1px solid var(--app-border);border-radius:1rem}.solution-tweak-field{display:grid;grid-template-columns:minmax(7rem,.7fr) minmax(0,1.3fr);gap:.55rem;align-items:center}.solution-tweak-field select{width:100%;min-width:0}.solution-tweak-rotations{display:grid;grid-template-columns:1fr auto 1fr;gap:.45rem;align-items:center}.solution-tweak-rotations .pages-button{width:100%;justify-content:center}.solution-tweak-rotation-label{text-align:center;font-weight:800;min-width:4.5rem}
    .solution-tweak-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem}.solution-tweak-actions .pages-button{width:100%;justify-content:center;min-width:0}.solution-tweak-pending{display:flex;gap:.35rem;flex-wrap:wrap}.solution-tweak-pill{border:1px solid var(--app-border);border-radius:999px;padding:.3rem .5rem;font-size:.66rem;background:rgba(255,255,255,.03)}
    .solution-tweak-status{margin:0;font-size:.72rem;line-height:1.4;opacity:.84}.solution-tweak-status[data-ok="true"]{opacity:1;font-weight:750}.solution-tweak-calculate{width:100%!important;justify-content:center!important}
    .solution-tweak-playback{display:grid;gap:.55rem}.solution-tweak-sequence{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;line-height:1.5;padding:.6rem;border:1px solid var(--app-border);border-radius:.8rem;word-break:break-word}.solution-tweak-playback__buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem}.solution-tweak-playback__buttons .pages-button{width:100%;justify-content:center}.solution-tweak-hint{font-size:.7rem;opacity:.72;text-align:center;margin:.35rem 0 0}
    @media(max-width:520px){.solution-tweak-field{grid-template-columns:1fr}.solution-tweak-actions{grid-template-columns:1fr 1fr}.solution-tweak-card{padding:.65rem}.solution-tweak-playback__buttons{grid-template-columns:1fr 1fr}.solution-tweak-playback__buttons [data-tweak-play]{grid-column:1/-1}}
  `;document.head.appendChild(style);
}

function ensureRoot(){
  if(state.root)return state.root;installStyles();
  const root=document.createElement("div");root.className="solution-tweak-modal";root.hidden=true;root.innerHTML=`
    <section class="solution-tweak-card" role="dialog" aria-modal="true" aria-labelledby="solution-tweak-title">
      <header class="solution-tweak-head"><h2 id="solution-tweak-title">Solved cube tweaks</h2><button class="pages-button pages-button--quiet solution-tweak-close" type="button" data-tweak-close aria-label="Close">×</button></header>
      <div data-tweak-editor>
        <div class="solution-tweak-compare">
          <figure class="solution-tweak-preview"><div class="solution-tweak-preview__box" data-tweak-photo></div><figcaption data-tweak-photo-label></figcaption></figure>
          <figure class="solution-tweak-preview"><div class="solution-tweak-preview__box" data-tweak-reference></div><figcaption data-tweak-reference-label></figcaption></figure>
        </div>
        <div class="solution-tweak-controls">
          <label class="solution-tweak-field"><span>Reference segment</span><select data-tweak-target></select></label>
          <div class="solution-tweak-rotations"><button class="pages-button pages-button--quiet" type="button" data-tweak-ccw>↺ 90°</button><span class="solution-tweak-rotation-label" data-tweak-rotation>0°</span><button class="pages-button pages-button--quiet" type="button" data-tweak-cw>↻ 90°</button></div>
          <div class="solution-tweak-actions"><button class="pages-button pages-button--primary" type="button" data-tweak-set>Set tweak</button><button class="pages-button pages-button--quiet" type="button" data-tweak-clear>Clear selected tweak</button><button class="pages-button pages-button--quiet" type="button" data-tweak-reset>Reset all tweaks</button><button class="pages-button pages-button--quiet" type="button" data-tweak-select-another>Select another sticker</button></div>
        </div>
        <div class="solution-tweak-pending" data-tweak-pending></div>
        <p class="solution-tweak-status" data-tweak-status></p>
        <button class="pages-button pages-button--primary solution-tweak-calculate" type="button" data-tweak-calculate>Calculate legal moves</button>
      </div>
      <div class="solution-tweak-playback" data-tweak-playback hidden>
        <strong data-tweak-playback-title>Moves from solved cube to tweaked target</strong>
        <div class="solution-tweak-sequence" data-tweak-sequence></div>
        <p class="solution-tweak-status" data-tweak-move-status></p>
        <div class="solution-tweak-playback__buttons"><button class="pages-button pages-button--quiet" type="button" data-tweak-prev>Previous</button><button class="pages-button pages-button--primary" type="button" data-tweak-play>Play</button><button class="pages-button pages-button--quiet" type="button" data-tweak-next>Next</button><button class="pages-button pages-button--quiet" type="button" data-tweak-instant>Show target</button><button class="pages-button pages-button--quiet" type="button" data-tweak-back>Back to tweaks</button></div>
      </div>
    </section>`;
  document.body.appendChild(root);state.root=root;
  root.querySelector("[data-tweak-close]").addEventListener("click",()=>closeModal());
  root.querySelector("[data-tweak-target]").addEventListener("change",event=>{state.draftTarget=Number(event.target.value);renderDraft();});
  root.querySelector("[data-tweak-ccw]").addEventListener("click",()=>{state.draftRotation=mod4(state.draftRotation-1);renderDraft();});
  root.querySelector("[data-tweak-cw]").addEventListener("click",()=>{state.draftRotation=mod4(state.draftRotation+1);renderDraft();});
  root.querySelector("[data-tweak-set]").addEventListener("click",applyDraft);
  root.querySelector("[data-tweak-clear]").addEventListener("click",clearSelected);
  root.querySelector("[data-tweak-reset]").addEventListener("click",()=>{state.tweaks.clear();state.centerRotations=[0,0,0,0,0,0];syncSelectedDraft();analyseTarget();renderEditor();});
  root.querySelector("[data-tweak-select-another]").addEventListener("click",()=>{root.hidden=true;});
  root.querySelector("[data-tweak-calculate]").addEventListener("click",calculateMoves);
  root.querySelector("[data-tweak-prev]").addEventListener("click",previousMove);
  root.querySelector("[data-tweak-next]").addEventListener("click",nextMove);
  root.querySelector("[data-tweak-play]").addEventListener("click",togglePlay);
  root.querySelector("[data-tweak-instant]").addEventListener("click",showTargetInstant);
  root.querySelector("[data-tweak-back]").addEventListener("click",async()=>{await resetPlayback();showEditor();});
  return root;
}

function snapshotSticker(sticker){
  const image=sticker?.material?.map?.image;if(!image)return null;
  try{const canvas=document.createElement("canvas");canvas.width=192;canvas.height=192;canvas.getContext("2d").drawImage(image,0,0,192,192);return canvas.toDataURL("image/jpeg",.88);}catch(_){return null;}
}
function pickSticker(view,clientX,clientY){
  const canvas=view?.renderer?.domElement;if(!canvas)return null;const rect=canvas.getBoundingClientRect();
  const pointer=new THREE.Vector2(((clientX-rect.left)/rect.width)*2-1,-((clientY-rect.top)/rect.height)*2+1),raycaster=new THREE.Raycaster();raycaster.setFromCamera(pointer,view.camera);
  const hit=raycaster.intersectObjects(view.root.children,true).find(item=>item.object?.material?.map);if(!hit)return null;
  const sticker=hit.object,cubelet=sticker.parent;if(!cubelet)return null;
  const worldQ=new THREE.Quaternion();sticker.getWorldQuaternion(worldQ);const normal=new THREE.Vector3(0,0,1).applyQuaternion(worldQ).normalize();
  let face="F",best=-Infinity;for(const name of FACE_NAMES){const score=normal.dot(NORMAL[name]);if(score>best){best=score;face=name;}}
  const centre=(Number(view.size||3)-1)/2,pos=cubelet.position,col=Math.round(pos.dot(RIGHT[face])+centre),row=Math.round(centre-pos.dot(UP[face]));
  if(row<0||row>2||col<0||col>2)return null;const tile=FACE_NAMES.indexOf(face)*9+row*3+col;
  return{tile,sticker,photo:snapshotSticker(sticker)};
}

async function openDb(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return resolve(null);const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("reference"))db.createObjectStore("reference",{keyPath:"key"});if(!db.objectStoreNames.contains("evidence"))db.createObjectStore("evidence",{keyPath:"key"});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function loadReferenceFaces(){
  if(state.referenceFaces.size)return;const db=await openDb().catch(()=>null);if(!db)return;
  try{const tx=db.transaction("reference","readonly"),request=tx.objectStore("reference").get("current"),record=await new Promise(resolve=>{request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>resolve(null);});const ref=record?.evidence?.reference||{},previews=Array.isArray(ref.solved_face_previews)?ref.solved_face_previews:[],order=Array.isArray(ref.face_order)&&ref.face_order.length===6?ref.face_order:FACE_NAMES;order.forEach((face,index)=>{if(previews[index])state.referenceFaces.set(face,previews[index]);});}finally{db.close();}
}
function referenceCropStyle(tile){
  const face=FACE_NAMES[Math.floor(tile/9)],local=tile%9,row=Math.floor(local/3),col=local%3,src=state.referenceFaces.get(face);if(!src)return{backgroundImage:"none"};
  return{backgroundImage:`url(${JSON.stringify(src).slice(1,-1)})`,backgroundSize:"300% 300%",backgroundPosition:`${col*50}% ${row*50}%`};
}
function syncSelectedDraft(){
  if(state.selectedTile==null)return;const tile=Number(state.selectedTile);
  if(CENTRES.has(tile)){state.draftTarget=tile;state.draftRotation=mod4(state.centerRotations[FACE_NAMES.indexOf(FACE_NAMES[Math.floor(tile/9)])]);return;}
  const existing=state.tweaks.get(tile);state.draftTarget=Number(existing?.target??tile);state.draftRotation=mod4(existing?.rotation??0);
}
function updateTargetOptions(){
  const select=state.root?.querySelector("[data-tweak-target]");if(!select||state.selectedTile==null)return;select.textContent="";for(const target of candidateTargets(Number(state.selectedTile))){const option=document.createElement("option");option.value=String(target);option.textContent=labelForFacelet(target);select.appendChild(option);}select.value=String(state.draftTarget);select.disabled=CENTRES.has(Number(state.selectedTile));
}
function renderDraft(){
  if(!state.root||state.selectedTile==null)return;updateTargetOptions();const rotation=state.root.querySelector("[data-tweak-rotation]");if(rotation)rotation.textContent=`${state.draftRotation*90}°`;
  const ref=state.root.querySelector("[data-tweak-reference]"),style=referenceCropStyle(Number(state.draftTarget));Object.assign(ref.style,style);
  const refLabel=state.root.querySelector("[data-tweak-reference-label]");if(refLabel)refLabel.textContent=`Reference · ${labelForFacelet(Number(state.draftTarget))} · ${state.draftRotation*90}°`;
}
function renderPending(){
  const pending=state.root?.querySelector("[data-tweak-pending]");if(!pending)return;pending.textContent="";
  const items=[...state.tweaks].sort((a,b)=>a[0]-b[0]).map(([tile,tweak])=>`${labelForFacelet(tile)} → ${labelForFacelet(tweak.target)} · ${tweak.rotation*90}°`);
  state.centerRotations.forEach((rotation,face)=>{if(rotation)items.push(`${FACE_NAMES[face]} centre · ${rotation*90}°`);});
  for(const text of items){const pill=document.createElement("span");pill.className="solution-tweak-pill";pill.textContent=text;pending.appendChild(pill);}
  if(!items.length){const pill=document.createElement("span");pill.className="solution-tweak-pill";pill.textContent="No tweaks yet";pending.appendChild(pill);}
}
function renderAnalysis(){
  const analysis=state.analysis||analyseTarget(),status=state.root?.querySelector("[data-tweak-status]"),button=state.root?.querySelector("[data-tweak-calculate]");if(!status||!button)return;
  let ok=false,text="";
  if(!analysis?.ok)text=`Not currently reachable: ${analysis?.conflict||"the requested mappings contradict legal 3×3 mechanics"} Keep the draft and add or change another tweak.`;
  else if(Number(analysis.legalStateCount)!==1)text=`Mechanically possible, but ${Number(analysis.legalStateCount||0).toLocaleString()} legal completions still match these tweaks. Specify another sticker/cubie or rotation so the target is exact.`;
  else{ok=Boolean(analysis.resolved?.resolved);text=ok?"Exact cubie target is legal. Centre-orientation reachability will be checked when moves are calculated.":"The cubie target is legal but not yet fully specified.";}
  status.textContent=text;status.dataset.ok=String(ok);button.disabled=state.busy||!ok;
}
function renderEditor(){renderDraft();renderPending();renderAnalysis();const photo=state.root?.querySelector("[data-tweak-photo]");if(photo){photo.style.backgroundImage=state.selectedPhoto?`url(${state.selectedPhoto})`:"none";}const photoLabel=state.root?.querySelector("[data-tweak-photo-label]");if(photoLabel&&state.selectedTile!=null)photoLabel.textContent=`Solved position · ${labelForFacelet(state.selectedTile)}`;const clear=state.root?.querySelector("[data-tweak-clear]");if(clear&&state.selectedTile!=null){const tile=Number(state.selectedTile);clear.disabled=CENTRES.has(tile)?!state.centerRotations[Math.floor(tile/9)]:!state.tweaks.has(tile);}}

function applyDraft(){
  if(state.selectedTile==null)return;const tile=Number(state.selectedTile);
  if(CENTRES.has(tile)){state.centerRotations[Math.floor(tile/9)]=mod4(state.draftRotation);}else if(Number(state.draftTarget)===tile&&mod4(state.draftRotation)===0)state.tweaks.delete(tile);else state.tweaks.set(tile,{target:Number(state.draftTarget),rotation:mod4(state.draftRotation)});
  analyseTarget();renderEditor();
}
function clearSelected(){
  if(state.selectedTile==null)return;const tile=Number(state.selectedTile);if(CENTRES.has(tile))state.centerRotations[Math.floor(tile/9)]=0;else state.tweaks.delete(tile);syncSelectedDraft();analyseTarget();renderEditor();
}

async function openModal(pick){
  if(!isPicture3x3()||!isSolvedVisual())return;const root=ensureRoot();state.view=window.__activePictureCubeView;state.selectedTile=Number(pick.tile);state.selectedPhoto=pick.photo;state.playback=null;state.playbackIndex=0;state.playing=false;syncSelectedDraft();analyseTarget();await loadReferenceFaces();renderEditor();showEditor();root.hidden=false;
}
function showEditor(){if(!state.root)return;state.root.querySelector("[data-tweak-editor]").hidden=false;state.root.querySelector("[data-tweak-playback]").hidden=true;renderEditor();}
function showPlayback(){if(!state.root)return;state.root.querySelector("[data-tweak-editor]").hidden=true;state.root.querySelector("[data-tweak-playback]").hidden=false;renderPlayback();}
async function closeModal(){
  state.playing=false;if(state.playback&&state.playbackIndex>0&&state.playbackIndex<(state.playback.moves||[]).length)await resetPlayback();if(state.root)state.root.hidden=true;
}

function calculateMoves(){
  const analysis=state.analysis||analyseTarget(),worker=window.__pictureCubeSolverWorker;if(state.busy||!worker||!analysis?.resolved?.resolved||Number(analysis.legalStateCount)!==1)return;
  state.busy=true;renderAnalysis();const status=state.root.querySelector("[data-tweak-status]");status.textContent="Calculating a legal move sequence from the solved cube…";
  worker.postMessage({type:"solve",payload:{size:3,tile_size:1,rgb_b64:"",post_solve_tweak:{manual:analysis.resolved,center_rotations:state.centerRotations.slice()}}});
}
window.addEventListener("picture-tweak-solution",event=>{state.busy=false;state.playback=event.detail||null;state.playbackIndex=0;state.playing=false;showPlayback();});
window.addEventListener("picture-tweak-error",event=>{state.busy=false;const status=ensureRoot().querySelector("[data-tweak-status]");status.textContent=event.detail?.error||"That tweaked target cannot be reached legally.";status.dataset.ok="false";renderAnalysis();});

function renderPlayback(){
  const result=state.playback,moves=result?.moves||[],sequence=state.root?.querySelector("[data-tweak-sequence]"),status=state.root?.querySelector("[data-tweak-move-status]");if(sequence)sequence.textContent=moves.length?moves.join(" "):"No moves needed";
  if(status)status.textContent=moves.length?`${state.playbackIndex}/${moves.length} moves applied from the canonical solved cube.`:"The solved cube already matches this requested target.";
  const prev=state.root?.querySelector("[data-tweak-prev]"),next=state.root?.querySelector("[data-tweak-next]"),play=state.root?.querySelector("[data-tweak-play]"),instant=state.root?.querySelector("[data-tweak-instant]");if(prev)prev.disabled=state.busy||state.playbackIndex<=0;if(next)next.disabled=state.busy||state.playbackIndex>=moves.length;if(play){play.disabled=state.busy||!moves.length;play.textContent=state.playing?"Pause":"Play";}if(instant)instant.disabled=state.busy||state.playbackIndex>=moves.length;
}
async function nextMove(){const moves=state.playback?.moves||[];if(state.busy||state.playbackIndex>=moves.length||!state.view)return;state.busy=true;renderPlayback();try{await state.view.move(moves[state.playbackIndex]);state.playbackIndex++;}finally{state.busy=false;renderPlayback();}}
async function previousMove(){const moves=state.playback?.moves||[];if(state.busy||state.playbackIndex<=0||!state.view)return;state.busy=true;renderPlayback();try{await state.view.inverseMove(moves[state.playbackIndex-1]);state.playbackIndex--;}finally{state.busy=false;renderPlayback();}}
async function resetPlayback(){state.playing=false;while(state.playbackIndex>0)await previousMove();renderPlayback();}
async function togglePlay(){if(state.busy||!state.playback)return;state.playing=!state.playing;renderPlayback();while(state.playing&&state.playbackIndex<(state.playback.moves||[]).length){await nextMove();await new Promise(resolve=>setTimeout(resolve,120));}state.playing=false;renderPlayback();}
function showTargetInstant(){const moves=state.playback?.moves||[];if(state.busy||!state.view||typeof state.view.showMovesInstant!=="function"||state.playbackIndex>=moves.length)return;const remaining=moves.slice(state.playbackIndex);if(state.view.showMovesInstant(remaining)){state.playbackIndex=moves.length;renderPlayback();}}

const cubeContainer=document.querySelector("#cube-view");
cubeContainer?.addEventListener("pointerdown",event=>{state.pointerStart={x:event.clientX,y:event.clientY,t:event.timeStamp};});
cubeContainer?.addEventListener("pointerup",event=>{const start=state.pointerStart;state.pointerStart=null;if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>8||event.timeStamp-start.t>700||!isPicture3x3()||!isSolvedVisual())return;const view=window.__activePictureCubeView,pick=pickSticker(view,event.clientX,event.clientY);if(pick)openModal(pick);});

function ensureHint(){const container=document.querySelector("#cube-view");if(!container)return;let hint=container.parentElement?.querySelector("[data-solved-tweak-hint]");if(!hint){hint=document.createElement("p");hint.className="solution-tweak-hint";hint.dataset.solvedTweakHint="";hint.textContent="When the 3D cube is solved, tap any sticker to request an exact legal picture tweak.";container.insertAdjacentElement("afterend",hint);}hint.hidden=!isPicture3x3();}
ensureHint();window.addEventListener("picture-cube-mode-changed",ensureHint);
