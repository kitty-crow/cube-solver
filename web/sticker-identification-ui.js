import { FACE_NAMES, CENTRE_FACELETS, labelForFacelet, isCentreFacelet } from "./sticker-constraints.js";

const TILE_COUNT=54;
const SIZE=3;
const centreSet=new Set(CENTRE_FACELETS);

function installStyles(){
  if(document.querySelector("#sticker-identification-styles"))return;
  const style=document.createElement("style");
  style.id="sticker-identification-styles";
  style.textContent=`
    .sticker-id { position:fixed; inset:0; z-index:1300; display:grid; place-items:center; padding:max(1rem,env(safe-area-inset-top)) 1rem max(1rem,env(safe-area-inset-bottom)); background:color-mix(in srgb,#000 58%,transparent); }
    .sticker-id[hidden] { display:none; }
    .sticker-id__panel { width:min(62rem,100%); max-height:calc(100dvh - 2rem); overflow:auto; display:grid; gap:.85rem; padding:1rem; border:1px solid var(--app-border); border-radius:1rem; background:var(--pages-bg,#fff); color:inherit; box-shadow:0 1rem 4rem rgba(0,0,0,.3); }
    .sticker-id__head,.sticker-id__stats,.sticker-id__actions,.sticker-id__suggestions { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
    .sticker-id__head { justify-content:space-between; }
    .sticker-id__head h2 { margin:0; font-size:1.1rem; }
    .sticker-id__stats { font-size:.72rem; opacity:.82; }
    .sticker-id__stat { padding:.28rem .48rem; border:1px solid var(--app-border); border-radius:999px; }
    .sticker-id__work { display:grid; grid-template-columns:minmax(15rem,1fr) minmax(15rem,1fr); gap:1rem; align-items:start; }
    .sticker-id__viewer-wrap { display:grid; gap:.5rem; }
    .sticker-id__viewer { position:relative; width:min(100%,24rem); aspect-ratio:1; overflow:hidden; touch-action:none; border:1px solid var(--app-border); border-radius:.9rem; background:#111; justify-self:center; }
    .sticker-id__viewer canvas { position:absolute; inset:0; width:100%; height:100%; }
    .sticker-id__reticle { position:absolute; inset:0; pointer-events:none; border:2px solid color-mix(in srgb,var(--pages-accent) 72%,white 28%); border-radius:.88rem; box-shadow:inset 0 0 0 1px rgba(255,255,255,.45); }
    .sticker-id__viewer-help { margin:0; font-size:.72rem; opacity:.7; text-align:center; }
    .sticker-id__question { display:grid; gap:.55rem; }
    .sticker-id__question h3 { margin:0; font-size:1rem; }
    .sticker-id__scan { width:min(11rem,55vw); aspect-ratio:1; border-radius:.75rem; border:1px solid var(--app-border); image-rendering:auto; }
    .sticker-id__candidate { font-size:.9rem; font-weight:750; }
    .sticker-id__note { margin:0; font-size:.74rem; opacity:.75; }
    .sticker-id__suggestions button { font-size:.68rem; }
    .sticker-id__grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:.28rem; }
    .sticker-id__cell { min-width:0; padding:.34rem .15rem; border:1px solid var(--app-border); border-radius:.45rem; background:transparent; color:inherit; font-size:.58rem; cursor:pointer; }
    .sticker-id__cell--confirmed { outline:2px solid var(--pages-accent); }
    .sticker-id__cell--inferred { opacity:.58; background:color-mix(in srgb,var(--pages-accent) 9%,transparent); }
    .sticker-id__cell--unresolved { font-weight:750; }
    .sticker-id__cell--active { box-shadow:inset 0 0 0 2px currentColor; }
    .sticker-id__resolved { padding:.7rem; border:1px solid var(--app-border); border-radius:.7rem; font-weight:750; }
    @media(max-width:720px){ .sticker-id__work{grid-template-columns:1fr}.sticker-id__grid{grid-template-columns:repeat(8,minmax(0,1fr));}.sticker-id__panel{padding:.75rem;} }
  `;
  document.head.appendChild(style);
}

function decodeBase64(encoded){
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function canvasFromRawTile(raw,tileSize,tile){
  const canvas=document.createElement("canvas");
  canvas.width=tileSize;canvas.height=tileSize;
  const ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true}),image=ctx.createImageData(tileSize,tileSize);
  const start=tile*tileSize*tileSize*3;
  for(let i=0,p=start;i<image.data.length;i+=4,p+=3){image.data[i]=raw[p];image.data[i+1]=raw[p+1];image.data[i+2]=raw[p+2];image.data[i+3]=255;}
  ctx.putImageData(image,0,0);return canvas;
}
function loadImage(url){
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("Could not load solved reference face"));image.src=url;});
}
function clone(value){return value==null?value:structuredClone(value);}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
const NORMAL=[[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
const RIGHT=[[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
const UP=[[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];
function add3(a,b,c){return[a[0]+b[0]+c[0],a[1]+b[1]+c[1],a[2]+b[2]+c[2]];}
function mul3(a,k){return[a[0]*k,a[1]*k,a[2]*k];}
function foldSurface(face,u,v){
  const direction=add3(NORMAL[face],mul3(RIGHT[face],u),mul3(UP[face],v));
  let axis=0;if(Math.abs(direction[1])>Math.abs(direction[axis]))axis=1;if(Math.abs(direction[2])>Math.abs(direction[axis]))axis=2;
  let nextFace;
  if(axis===0)nextFace=direction[0]>=0?1:4;else if(axis===1)nextFace=direction[1]>=0?0:3;else nextFace=direction[2]>=0?2:5;
  const denom=Math.max(1e-9,dot(direction,NORMAL[nextFace]));
  return{face:nextFace,u:dot(direction,RIGHT[nextFace])/denom,v:dot(direction,UP[nextFace])/denom};
}
function faceletFromPan(pan){
  const col=clamp(Math.floor((pan.u+1)*1.5),0,2),row=clamp(Math.floor((1-pan.v)*1.5),0,2);
  return pan.face*9+row*3+col;
}
function panForFacelet(target){
  const face=Math.floor(target/9),local=target%9,row=Math.floor(local/3),col=local%3;
  return{face,u:-1+(col+.5)*2/3,v:1-(row+.5)*2/3};
}
function centreRotations(candidate){
  const out=[0,0,0,0,0,0];
  for(const anchor of candidate?.alignment?.anchors||[]){
    const face=FACE_NAMES.indexOf(String(anchor?.target||anchor?.source||""));
    if(face>=0)out[face]=((Number(anchor?.scanRotation)||0)%4+4)%4;
  }
  return out;
}
function stateSignature(candidate){
  const p=candidate?.projection||{};
  return JSON.stringify({title:candidate?.title||"",orientation:p.orientation||null,faceOrientations:p.faceOrientations||null,faceWarps:p.faceWarps||null,mappingVersion:p.mappingVersion||0});
}

export class StickerIdentificationModal{
  constructor({onChange,onResolved,onStatus}={}){
    installStyles();
    this.onChange=onChange||(()=>{});this.onResolved=onResolved||(()=>{});this.onStatus=onStatus||(()=>{});
    this.worker=new Worker(new URL("./sticker-constraint-worker.js",import.meta.url),{type:"module"});
    this.requestId=0;this.pending=new Map();this.saveTimer=null;this.drag=null;this.overlayOpacity=.38;
    this.worker.addEventListener("message",event=>{
      const msg=event.data||{},pending=this.pending.get(msg.requestId);if(!pending)return;this.pending.delete(msg.requestId);
      if(msg.type==="analysis")pending.resolve(msg.analysis);else pending.reject(new Error(msg.message||"Constraint analysis failed"));
    });
    this.root=this.makeRoot();document.body.appendChild(this.root);
  }
  makeRoot(){
    const root=document.createElement("section");root.className="sticker-id";root.hidden=true;root.innerHTML=`
      <div class="sticker-id__panel" role="dialog" aria-modal="true" aria-labelledby="sticker-id-title">
        <div class="sticker-id__head"><div><h2 id="sticker-id-title">Identify scrambled stickers</h2><p class="sticker-id__note" data-id-subtitle>The solved wrap is frozen. Pan only, plus legal quarter-turns.</p></div><button type="button" class="pages-button pages-button--quiet" data-id-close>Close</button></div>
        <div class="sticker-id__stats" data-id-stats></div>
        <div class="sticker-id__resolved" data-id-resolved hidden></div>
        <div class="sticker-id__work">
          <div class="sticker-id__viewer-wrap">
            <div class="sticker-id__viewer" data-id-viewer><canvas data-id-reference width="360" height="360"></canvas><canvas data-id-overlay width="360" height="360"></canvas><span class="sticker-id__reticle"></span></div>
            <p class="sticker-id__viewer-help">Drag the frozen reference underneath the photographed sticker. Crossing an edge continues onto the adjacent cube face.</p>
            <div class="sticker-id__actions"><button type="button" class="pages-button" data-id-rotate>Rotate 90°</button><button type="button" class="pages-button pages-button--quiet" data-id-overlay-toggle>Overlay 38%</button></div>
          </div>
          <div class="sticker-id__question">
            <h3 data-id-question>Photographed sticker</h3>
            <canvas class="sticker-id__scan" data-id-scan width="160" height="160"></canvas>
            <div class="sticker-id__candidate" data-id-candidate></div>
            <p class="sticker-id__note" data-id-domain></p>
            <div class="sticker-id__suggestions" data-id-suggestions></div>
            <div class="sticker-id__actions"><button type="button" class="pages-button pages-button--primary" data-id-confirm>Confirm</button><button type="button" class="pages-button" data-id-next>Not sure · next</button><button type="button" class="pages-button pages-button--quiet" data-id-unassign hidden>Unassign</button></div>
            <p class="sticker-id__note" data-id-message></p>
          </div>
        </div>
        <div class="sticker-id__grid" data-id-grid aria-label="Photographed sticker assignments"></div>
      </div>`;
    this.viewer=root.querySelector("[data-id-viewer]");this.referenceCanvas=root.querySelector("[data-id-reference]");this.overlayCanvas=root.querySelector("[data-id-overlay]");this.scanCanvas=root.querySelector("[data-id-scan]");
    this.statsEl=root.querySelector("[data-id-stats]");this.resolvedEl=root.querySelector("[data-id-resolved]");this.questionEl=root.querySelector("[data-id-question]");this.candidateEl=root.querySelector("[data-id-candidate]");this.domainEl=root.querySelector("[data-id-domain]");this.suggestionsEl=root.querySelector("[data-id-suggestions]");this.messageEl=root.querySelector("[data-id-message]");this.gridEl=root.querySelector("[data-id-grid]");
    this.rotateButton=root.querySelector("[data-id-rotate]");this.confirmButton=root.querySelector("[data-id-confirm]");this.nextButton=root.querySelector("[data-id-next]");this.unassignButton=root.querySelector("[data-id-unassign]");this.overlayButton=root.querySelector("[data-id-overlay-toggle]");
    root.querySelector("[data-id-close]").addEventListener("click",()=>this.close());
    this.rotateButton.addEventListener("click",()=>this.rotateAllowed());this.confirmButton.addEventListener("click",()=>this.confirmCurrent());this.nextButton.addEventListener("click",()=>this.nextQuestion());this.unassignButton.addEventListener("click",()=>this.unassignCurrent());this.overlayButton.addEventListener("click",()=>this.cycleOverlay());
    this.viewer.addEventListener("pointerdown",event=>this.pointerDown(event));this.viewer.addEventListener("pointermove",event=>this.pointerMove(event));this.viewer.addEventListener("pointerup",event=>this.pointerUp(event));this.viewer.addEventListener("pointercancel",event=>this.pointerUp(event));
    return root;
  }
  async analyse(confirmations){
    const requestId=++this.requestId,input={confirmations,absoluteF32B64:this.candidate?.evidence?.absolute_f32_b64||"",centerRotations:this.centerRotations};
    return new Promise((resolve,reject)=>{this.pending.set(requestId,{resolve,reject});this.worker.postMessage({type:"analyse",requestId,input});});
  }
  async open({candidate,payload,state=null}={}){
    if(!candidate?.facePreviews||candidate.facePreviews.length!==6)throw new Error("The solved reference wrap must be aligned before sticker identification.");
    if(Number(payload?.size)!==3)throw new Error("Adaptive manual sticker identification currently applies to 3×3 cubes.");
    this.candidate=candidate;this.payload=payload;this.signature=stateSignature(candidate);this.centerRotations=centreRotations(candidate);
    const raw=decodeBase64(payload.rgb_b64),tileSize=Number(payload.tile_size||48);this.scanTiles=Array.from({length:TILE_COUNT},(_,tile)=>canvasFromRawTile(raw,tileSize,tile));
    this.faceImages=await Promise.all(candidate.facePreviews.map(loadImage));
    const compatible=state&&state.referenceSignature===this.signature;
    this.state=compatible?clone(state):{version:1,referenceSignature:this.signature,confirmations:{},currentTile:null,pan:null,quarterTurn:0,resolved:null};
    this.state.confirmations=this.state.confirmations||{};
    this.analysis=await this.analyse(this.state.confirmations);
    if(!this.analysis.ok){this.state.confirmations={};this.analysis=await this.analyse({});}
    if(this.analysis.resolved)this.state.resolved=this.analysis.resolved;
    const wanted=Number(this.state.currentTile);
    this.currentTile=Number.isInteger(wanted)&&this.analysis.stickers?.[wanted]?wanted:this.analysis.nextTile;
    this.state.currentTile=this.currentTile;
    this.setInitialPan(Boolean(compatible));
    this.root.hidden=false;this.render();this.queueSave();
  }
  close(){clearTimeout(this.saveTimer);this.flushState();this.root.hidden=true;}
  destroy(){this.worker.terminate();this.root.remove();}
  serialise(){return{version:1,referenceSignature:this.signature,confirmations:clone(this.analysis?.confirmations||this.state?.confirmations||{}),currentTile:this.currentTile,pan:clone(this.pan),quarterTurn:this.quarterTurn,resolved:clone(this.analysis?.resolved||null),summary:this.analysis?{confirmedCount:this.analysis.confirmedCount,inferredCount:this.analysis.inferredCount,unresolvedCount:this.analysis.unresolvedCount,legalStateCount:this.analysis.legalStateCount}:null};}
  queueSave(){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.flushState(),160);}
  flushState(){if(!this.state)return;const serial=this.serialise();this.state=serial;Promise.resolve(this.onChange(serial)).catch(error=>console.warn("Could not persist sticker identification",error));}
  setInitialPan(keepSaved=false){
    const sticker=this.analysis?.stickers?.[this.currentTile];
    if(keepSaved&&this.state?.pan&&Number(this.state.currentTile)===Number(this.currentTile)){this.pan=clone(this.state.pan);this.quarterTurn=((Number(this.state.quarterTurn)||0)%4+4)%4;return;}
    const option=sticker?.confirmed||sticker?.best||sticker?.domain?.[0];
    this.pan=panForFacelet(option?.target??0);this.quarterTurn=((Number(option?.rotation)||0)%4+4)%4;
  }
  selectTile(tile,{keepPan=false}={}){
    if(!this.analysis?.stickers?.[tile])return;this.currentTile=Number(tile);this.state.currentTile=this.currentTile;
    if(!keepPan)this.setInitialPan(false);this.render();this.queueSave();
  }
  currentTarget(){return faceletFromPan(this.pan);}
  allowedForCurrentTarget(){
    const sticker=this.analysis?.stickers?.[this.currentTile];if(!sticker)return[];const target=this.currentTarget();return sticker.domain.filter(option=>option.target===target).map(option=>option.rotation).filter((value,index,array)=>array.indexOf(value)===index).sort();
  }
  normaliseQuarterTurn(){const allowed=this.allowedForCurrentTarget();if(allowed.length&&!allowed.includes(this.quarterTurn))this.quarterTurn=allowed[0];return allowed;}
  renderViewer(){
    const canvas=this.referenceCanvas,ctx=canvas.getContext("2d",{alpha:false});ctx.save();ctx.fillStyle="#111";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(this.quarterTurn*Math.PI/2);
    const image=this.faceImages?.[this.pan.face];if(image){const scale=3*canvas.width,xFrac=(this.pan.u+1)/2,yFrac=(1-this.pan.v)/2;ctx.drawImage(image,-xFrac*scale,-yFrac*scale,scale,scale);}ctx.restore();
    const overlay=this.overlayCanvas,octx=overlay.getContext("2d",{alpha:true});octx.clearRect(0,0,overlay.width,overlay.height);if(this.overlayOpacity>0&&this.scanTiles?.[this.currentTile]){octx.globalAlpha=this.overlayOpacity;octx.drawImage(this.scanTiles[this.currentTile],0,0,overlay.width,overlay.height);octx.globalAlpha=1;}
  }
  renderScan(){const ctx=this.scanCanvas.getContext("2d",{alpha:false});ctx.clearRect(0,0,this.scanCanvas.width,this.scanCanvas.height);if(this.scanTiles?.[this.currentTile])ctx.drawImage(this.scanTiles[this.currentTile],0,0,this.scanCanvas.width,this.scanCanvas.height);}
  render(){
    if(!this.analysis)return;
    const countText=this.analysis.legalStateCountCapped?`${this.analysis.legalStateCount.toLocaleString()}+`:this.analysis.legalStateCount.toLocaleString();
    this.statsEl.innerHTML=`<span class="sticker-id__stat">${this.analysis.confirmedCount} confirmed</span><span class="sticker-id__stat">${this.analysis.inferredCount} inferred</span><span class="sticker-id__stat">${this.analysis.unresolvedCount} unresolved</span><span class="sticker-id__stat">${countText} legal state${this.analysis.legalStateCount===1?"":"s"}</span>`;
    this.resolvedEl.hidden=!this.analysis.resolved;if(this.analysis.resolved)this.resolvedEl.textContent=`Unique legal scramble found. ${this.analysis.confirmedCount} manual confirmation${this.analysis.confirmedCount===1?"":"s"} were enough; the remaining ${48-this.analysis.confirmedCount} stickers are mechanically determined.`;
    if(this.currentTile==null&&this.analysis.nextTile!=null)this.currentTile=this.analysis.nextTile;
    const sticker=this.analysis.stickers?.[this.currentTile];if(!sticker){this.questionEl.textContent="Scramble resolved";this.candidateEl.textContent="No further sticker identification is required.";this.domainEl.textContent="";this.confirmButton.disabled=true;this.nextButton.disabled=true;this.unassignButton.hidden=true;this.renderGrid();return;}
    this.normaliseQuarterTurn();const target=this.currentTarget(),allowed=this.allowedForCurrentTarget(),pairAllowed=allowed.includes(this.quarterTurn),targetLabel=labelForFacelet(target);
    this.questionEl.textContent=`Photographed ${sticker.label} · ${sticker.status}`;this.candidateEl.textContent=isCentreFacelet(target)?`${targetLabel} is a fixed centre`:`${targetLabel} · ${this.quarterTurn*90}°`;
    this.domainEl.textContent=sticker.domain.length===1?"Only one legal position/orientation remains.":`${sticker.domain.length} position/rotation combinations remain legal for this sticker.`;
    this.confirmButton.disabled=Boolean(this.analysis.resolved)||!pairAllowed||isCentreFacelet(target);this.confirmButton.textContent=sticker.confirmed?"Update confirmation":"Confirm this segment";
    this.unassignButton.hidden=!sticker.confirmed;this.nextButton.disabled=Boolean(this.analysis.resolved)||this.analysis.unresolvedCount<=1;
    this.rotateButton.hidden=allowed.length<=1;this.rotateButton.disabled=allowed.length<=1;this.rotateButton.textContent=allowed.length>1?`Quarter turn · ${this.quarterTurn*90}°`:`Rotation ${this.quarterTurn*90}° fixed`;
    this.messageEl.textContent=!pairAllowed&&!isCentreFacelet(target)?"That target/rotation is no longer possible given the current legal cube states.":isCentreFacelet(target)?"Centres are already anchored by the solved-wrap alignment and are not reassigned here.":"The reference scale and wrap are frozen; only surface panning and legal quarter-turns are available.";
    this.renderSuggestions(sticker);this.renderViewer();this.renderScan();this.renderGrid();
  }
  renderSuggestions(sticker){
    this.suggestionsEl.textContent="";for(const option of sticker.domain.slice(0,5)){const button=document.createElement("button");button.type="button";button.className="pages-button pages-button--quiet";button.textContent=`${labelForFacelet(option.target)} · ${option.rotation*90}°${Number.isFinite(option.score)?` · ${(option.score*100).toFixed(0)}%`:""}`;button.addEventListener("click",()=>{this.pan=panForFacelet(option.target);this.quarterTurn=option.rotation;this.render();this.queueSave();});this.suggestionsEl.appendChild(button);}
  }
  renderGrid(){
    this.gridEl.textContent="";for(let tile=0;tile<54;tile++){if(centreSet.has(tile))continue;const sticker=this.analysis.stickers?.[tile];if(!sticker)continue;const button=document.createElement("button");button.type="button";button.className=`sticker-id__cell sticker-id__cell--${sticker.status}${tile===this.currentTile?" sticker-id__cell--active":""}`;const value=sticker.confirmed||((sticker.status==="inferred"&&sticker.domain.length===1)?sticker.domain[0]:null);button.textContent=value?`${sticker.label}→${labelForFacelet(value.target)}`:sticker.label;button.title=value?`${sticker.label} maps to ${labelForFacelet(value.target)} at ${value.rotation*90}°`: `${sticker.label}: ${sticker.domain.length} legal options`;button.addEventListener("click",()=>this.selectTile(tile));this.gridEl.appendChild(button);}
  }
  rotateAllowed(){const allowed=this.allowedForCurrentTarget();if(allowed.length<=1)return;const index=allowed.indexOf(this.quarterTurn);this.quarterTurn=allowed[(index+1)%allowed.length];this.render();this.queueSave();}
  cycleOverlay(){const values=[.38,.65,0],index=values.findIndex(v=>Math.abs(v-this.overlayOpacity)<.01);this.overlayOpacity=values[(index+1)%values.length];this.overlayButton.textContent=this.overlayOpacity?`Overlay ${Math.round(this.overlayOpacity*100)}%`:"Overlay off";this.renderViewer();}
  pointerDown(event){if(this.analysis?.resolved)return;this.viewer.setPointerCapture?.(event.pointerId);this.drag={id:event.pointerId,x:event.clientX,y:event.clientY};}
  pointerMove(event){if(!this.drag||this.drag.id!==event.pointerId)return;const rect=this.viewer.getBoundingClientRect(),dx=event.clientX-this.drag.x,dy=event.clientY-this.drag.y;this.drag.x=event.clientX;this.drag.y=event.clientY;let sx=dx,sy=dy;for(let i=0;i<this.quarterTurn;i++)[sx,sy]=[sy,-sx];const du=-sx/Math.max(1,rect.width)*(2/3),dv=sy/Math.max(1,rect.height)*(2/3);this.pan=foldSurface(this.pan.face,this.pan.u+du,this.pan.v+dv);this.normaliseQuarterTurn();this.renderViewer();const target=this.currentTarget(),allowed=this.allowedForCurrentTarget();this.candidateEl.textContent=isCentreFacelet(target)?`${labelForFacelet(target)} is a fixed centre`:`${labelForFacelet(target)} · ${this.quarterTurn*90}°`;this.confirmButton.disabled=!allowed.includes(this.quarterTurn)||isCentreFacelet(target);this.rotateButton.hidden=allowed.length<=1;this.queueSave();}
  pointerUp(event){if(this.drag?.id!==event.pointerId)return;this.drag=null;this.render();this.queueSave();}
  async confirmCurrent(){
    const target=this.currentTarget(),allowed=this.allowedForCurrentTarget();if(!allowed.includes(this.quarterTurn)||isCentreFacelet(target))return;
    const tentative={...(this.analysis.confirmations||{}),[this.currentTile]:{target,rotation:this.quarterTurn}},previous=this.analysis;this.messageEl.textContent="Checking cube legality…";this.confirmButton.disabled=true;
    const next=await this.analyse(tentative).catch(error=>({ok:false,conflict:error.message}));
    if(!next.ok||!next.legalStateCount){this.analysis=previous;this.messageEl.textContent=next.conflict||"That assignment conflicts with the remaining legal cube states.";this.render();return;}
    this.analysis=next;this.state.confirmations=clone(next.confirmations);this.state.resolved=clone(next.resolved||null);this.onStatus(`${next.confirmedCount} confirmed · ${next.inferredCount} inferred · ${next.unresolvedCount} unresolved`);
    if(next.resolved){this.currentTile=null;this.state.currentTile=null;this.flushState();await Promise.resolve(this.onResolved(this.serialise()));this.render();return;}
    this.currentTile=next.nextTile;this.state.currentTile=this.currentTile;this.setInitialPan(false);this.flushState();this.render();
  }
  async unassignCurrent(){
    const confirmations={...(this.analysis.confirmations||{})};delete confirmations[this.currentTile];const next=await this.analyse(confirmations);if(!next.ok)return;this.analysis=next;this.state.confirmations=clone(next.confirmations);this.state.resolved=null;this.setInitialPan(false);this.flushState();this.render();
  }
  nextQuestion(){
    const unresolved=Object.values(this.analysis.stickers||{}).filter(item=>item.status==="unresolved"&&item.tile!==this.currentTile).sort((a,b)=>b.priority-a.priority||a.tile-b.tile);if(!unresolved.length)return;this.selectTile(unresolved[0].tile);
  }
}
