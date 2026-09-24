import { ReferenceAlignmentModal as SmoothReferenceAlignmentModal } from "./reference-aligner-v2.js";
import { ReferenceAlignmentModal as BaseReferenceAlignmentModal } from "./reference-aligner.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const DISPLAY_FACE_ORDER=["F","R","B","L","U","D"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const TRANSFORM_KEYS=["move","rotate","scale","warp","yaw","pitch","roll"];
const TRANSFORM_LABELS={move:"Translation",rotate:"Rotation",scale:"Scale",warp:"Warp",yaw:"Yaw",pitch:"Pitch",roll:"Roll"};
const DEG=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(v)=>((v%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
const cloneOrientation=(v)=>({yaw:Number(v?.yaw||0),pitch:Number(v?.pitch||0),roll:Number(v?.roll||0)});
const cloneWarps=(warps)=>Object.fromEntries(FACE_NAMES.map(face=>[face,{points:Array.from({length:9},(_,i)=>{
  const p=warps?.[face]?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];
})}]));
const emptyWarp=()=>({points:Array.from({length:9},()=>[0,0])});
const cloneFaceOrientations=(value,fallback)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.[face]||fallback)]));
const cloneFaceLocks=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Boolean(Array.isArray(value)?value.includes(face):value?.[face])]));
const emptyTransformLocks=()=>Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,false]));
const cloneTransformLocks=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,Boolean(value?.[face]?.[key])]))]));
const normaliseAngleDelta=(value)=>{let v=value;while(v>Math.PI)v-=Math.PI*2;while(v< -Math.PI)v+=Math.PI*2;return v;};

function transformWarp(warp,{scale=1,angle=0,tx=0,ty=0}={}){
  const c=Math.cos(-angle),s=Math.sin(-angle),safeScale=clamp(Number(scale)||1,.25,4);
  return{points:Array.from({length:9},(_,i)=>{
    const col=i%3,row=Math.floor(i/3),bx=col/2,by=row/2,p=warp?.points?.[i]||[0,0];
    let sx=bx-(Number(p[0])||0),sy=by-(Number(p[1])||0);
    sx-=tx;sy-=ty;
    const x=(sx-.5)/safeScale,y=(sy-.5)/safeScale;
    sx=.5+c*x-s*y;sy=.5+s*x+c*y;
    return[clamp(bx-sx,-.42,.42),clamp(by-sy,-.42,.42)];
  })};
}

function estimatedScale(warp){
  const p=warp?.points||[];
  if(p.length<9)return 1;
  const source=(i)=>{const col=i%3,row=Math.floor(i/3),d=p[i]||[0,0];return[col/2-(Number(d[0])||0),row/2-(Number(d[1])||0)];};
  const l=source(3),r=source(5),t=source(1),b=source(7);
  const sx=1/Math.max(.05,Math.hypot(r[0]-l[0],r[1]-l[1]));
  const sy=1/Math.max(.05,Math.hypot(b[0]-t[0],b[1]-t[1]));
  return clamp((sx+sy)/2,.25,4);
}

function isEditableTarget(target){
  return target instanceof HTMLElement&&(target.isContentEditable||target.tagName==="INPUT"||target.tagName==="TEXTAREA"||target.tagName==="SELECT");
}

function installV3Styles(){
  if(document.querySelector("#reference-aligner-v3-styles"))return;
  const style=document.createElement("style");
  style.id="reference-aligner-v3-styles";
  style.textContent=`
    .reference-aligner__lockbar { margin-top:.5rem; padding-top:.5rem; border-top:1px solid var(--app-border); }
    .reference-aligner__lockbar-label { font-size:.7rem; opacity:.72; margin-right:.15rem; }
    .reference-aligner__face-button[data-locked="true"] { box-shadow:inset 0 0 0 1px currentColor; }
    .reference-aligner__face-button[data-locked="true"]::after { content:" · locked"; font-size:.66em; opacity:.75; }
  `;
  document.head.appendChild(style);
}

export class ReferenceAlignmentModal extends SmoothReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    installV3Styles();
    this.faceOrientations=cloneFaceOrientations(null,this.orientation);
    this.faceLocks=cloneFaceLocks();
    this.transformLocks=cloneTransformLocks();
  }

  makeRoot(){
    const root=super.makeRoot();
    const globalButton=root.querySelector('[data-align-mode="global"]');
    const faceButton=root.querySelector('[data-align-mode="face"]');
    if(globalButton)globalButton.textContent="Align artwork";
    if(faceButton)faceButton.textContent="Wrap selected face";
    for(const button of root.querySelectorAll("[data-align-roll]"))button.remove();

    const toolbar=globalButton?.closest(".reference-aligner__toolbar");
    if(toolbar){
      const faceLock=document.createElement("button");
      faceLock.type="button";
      faceLock.className="pages-button";
      faceLock.dataset.alignFaceLock="";
      faceLock.textContent="Lock face";
      faceLock.addEventListener("click",()=>this.toggleFaceLock());
      toolbar.appendChild(faceLock);

      const lockbar=document.createElement("div");
      lockbar.className="reference-aligner__toolbar reference-aligner__lockbar";
      const label=document.createElement("span");
      label.className="reference-aligner__lockbar-label";
      label.textContent="Lock selected face controls:";
      lockbar.appendChild(label);
      for(const key of TRANSFORM_KEYS){
        const button=document.createElement("button");
        button.type="button";
        button.className="pages-button";
        button.dataset.alignTransformLock=key;
        button.textContent=TRANSFORM_LABELS[key];
        button.setAttribute("aria-pressed","false");
        button.setAttribute("aria-label",`Lock ${TRANSFORM_LABELS[key].toLowerCase()} for selected face`);
        button.addEventListener("click",()=>this.toggleTransformLock(key));
        lockbar.appendChild(button);
      }
      toolbar.insertAdjacentElement("afterend",lockbar);
    }

    const resetAll=root.querySelector("[data-align-reset-all]");
    if(resetAll)resetAll.textContent="Reset unlocked to automatic";

    const faces=root.querySelector("[data-align-faces]");
    if(faces){
      const byFace=new Map([...faces.querySelectorAll("[data-align-face]")].map(button=>[button.dataset.alignFace,button]));
      for(const face of DISPLAY_FACE_ORDER){const button=byFace.get(face);if(button)faces.appendChild(button);}
    }
    return root;
  }

  async open(options={}){
    await super.open(options);
    const projection=options.candidate?.projection||{};
    this.faceOrientations=cloneFaceOrientations(projection.faceOrientations,this.orientation);
    this.faceLocks=cloneFaceLocks(projection.lockedFaces);
    this.transformLocks=cloneTransformLocks(projection.transformLocks);
    this.viewZoom=1;
    const requestedFace=typeof options.initialFaceIndex==="number"?options.initialFaceIndex:FACE_NAMES.indexOf(options.initialFace||"");
    if(requestedFace>=0)this.setFace(requestedFace);
    this.setMode(options.initialMode==="face"?"face":"global");
    this.updateLockControls();
    this.draw();
    this.schedulePreview(0);
  }

  adjustmentPayload(){
    return{
      orientation:cloneOrientation(this.orientation),
      faceOrientations:cloneFaceOrientations(this.faceOrientations,this.orientation),
      faceWarps:cloneWarps(this.faceWarps),
      lockedFaces:{...this.faceLocks},
      transformLocks:cloneTransformLocks(this.transformLocks),
    };
  }

  schedulePreview(delay=24){
    this.previewDirty=true;
    if(!this.worker||!this.adjustReady||this.previewInFlight||this.previewTimer)return;
    this.previewTimer=setTimeout(()=>{
      this.previewTimer=null;
      if(!this.worker||!this.adjustReady)return;
      const requestId=++this.requestId;
      this.previewDirty=false;
      this.previewInFlight=true;
      this.statusEl.textContent="Updating overlay…";
      this.worker.postMessage({type:"adjust-preview",sessionId:this.sessionId,requestId,adjustment:this.adjustmentPayload()});
    },Math.max(0,Math.min(Number(delay)||0,32)));
  }

  requestCommit(action){
    if(!this.worker||this.pendingCommitAction)return;
    this.pendingCommitAction=action;
    this.acceptButton.disabled=true;this.exportButton.disabled=true;
    const requestId=++this.requestId;
    this.statusEl.textContent=action==="apply"?"Rebuilding solver evidence…":"Building debug report…";
    this.worker.postMessage({type:"adjust-commit",sessionId:this.sessionId,requestId,adjustment:this.adjustmentPayload()});
  }

  currentFace(){return FACE_NAMES[this.faceIndex];}
  effectiveOrientation(face=this.currentFace()){return cloneOrientation(this.faceOrientations?.[face]||this.orientation);}
  isFaceLocked(face=this.currentFace()){return Boolean(this.faceLocks?.[face]);}
  isTransformLocked(face,key){return Boolean(this.transformLocks?.[face]?.[key]);}

  setMode(mode){
    super.setMode(mode);
    const face=this.currentFace();
    if(this.mode==="global"){
      this.hintEl.textContent="Global align moves only the internet artwork. Drag changes yaw and pitch, pinch scales, and twist rolls. Locked faces and locked controls are preserved.";
    }else if(this.isFaceLocked(face)){
      this.hintEl.textContent=`${face} is locked. Unlock this face before changing its mapping.`;
    }else{
      this.hintEl.textContent="The photographed face stays fixed. Drag the artwork, pinch to scale, twist to rotate, or move mesh handles. Lock any control you want to preserve.";
    }
    this.updateLockControls();
  }

  setFace(index){
    super.setFace(index);
    this.updateLockControls();
    if(this.mode==="face"&&this.isFaceLocked())this.hintEl.textContent=`${this.currentFace()} is locked. Unlock this face before changing its mapping.`;
  }

  updateLockControls(){
    if(!this.root)return;
    const face=this.currentFace();
    const locked=this.isFaceLocked(face);
    const faceLock=this.root.querySelector("[data-align-face-lock]");
    if(faceLock){
      faceLock.textContent=locked?`Unlock ${face}`:`Lock ${face}`;
      faceLock.setAttribute("aria-pressed",String(locked));
    }
    const locks=this.transformLocks?.[face]||emptyTransformLocks();
    for(const button of this.root.querySelectorAll("[data-align-transform-lock]")){
      const key=button.dataset.alignTransformLock;
      const active=Boolean(locks[key]);
      button.setAttribute("aria-pressed",String(active));
      button.title=`${active?"Unlock":"Lock"} ${TRANSFORM_LABELS[key].toLowerCase()} for ${face}`;
    }
    for(const button of this.root.querySelectorAll("[data-align-face]")){
      const buttonFace=button.dataset.alignFace;
      button.dataset.locked=String(Boolean(this.faceLocks?.[buttonFace]));
      button.textContent=`${FACE_LABELS[buttonFace]} · ${buttonFace}`;
    }
  }

  toggleFaceLock(){
    const face=this.currentFace();
    this.faceLocks[face]=!this.isFaceLocked(face);
    this.drag=null;this.gesture=null;
    this.updateLockControls();
    this.setMode(this.mode);
    this.changed();
  }

  toggleTransformLock(key){
    if(!TRANSFORM_KEYS.includes(key))return;
    const face=this.currentFace();
    this.transformLocks[face]??=emptyTransformLocks();
    this.transformLocks[face][key]=!this.transformLocks[face][key];
    this.updateLockControls();
    this.changed();
  }

  resetFace(){
    const face=this.currentFace();
    if(this.isFaceLocked(face)){this.statusEl.textContent=`Unlock ${face} before resetting it`;return;}
    this.faceWarps[face]=emptyWarp();
    this.faceOrientations[face]=cloneOrientation(this.autoOrientation);
    this.changed();
  }

  resetAll(){
    const warps=cloneWarps(this.faceWarps),orientations=cloneFaceOrientations(this.faceOrientations,this.orientation);
    for(const face of FACE_NAMES){
      if(this.isFaceLocked(face))continue;
      warps[face]=emptyWarp();
      orientations[face]=cloneOrientation(this.autoOrientation);
    }
    this.orientation=cloneOrientation(this.autoOrientation);
    this.faceWarps=warps;
    this.faceOrientations=orientations;
    this.changed();
  }

  beginSingleDrag(pointerId,raw){
    super.beginSingleDrag(pointerId,raw);
    if(!this.drag)return;
    if(this.drag.kind==="global"){
      this.drag.faceOrientations=cloneFaceOrientations(this.faceOrientations,this.orientation);
      this.drag.warps=cloneWarps(this.faceWarps);
      return;
    }
    const face=this.currentFace();
    if(this.isFaceLocked(face)||(this.drag.kind==="handle"&&this.isTransformLocked(face,"warp"))||(this.drag.kind==="face"&&this.isTransformLocked(face,"move")))this.drag=null;
  }

  beginGesture(){
    const entries=[...this.activePointers.entries()].slice(0,2);if(entries.length<2)return;
    const[[idA,a],[idB,b]]=entries,face=this.currentFace();
    if(this.mode==="face"&&this.isFaceLocked(face)){this.gesture=null;this.drag=null;return;}
    this.drag=null;
    this.gesture={
      ids:[idA,idB],
      startCentroid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},
      startDistance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),
      startAngle:Math.atan2(b.y-a.y,b.x-a.x),
      orientation:cloneOrientation(this.orientation),
      faceOrientations:cloneFaceOrientations(this.faceOrientations,this.orientation),
      warps:cloneWarps(this.faceWarps),
      faceIndex:this.faceIndex,
      mode:this.mode,
    };
  }

  applyGlobalSnapshot(snapshot,{yawDelta=0,pitchDelta=0,rollDelta=0,scale=1}={}){
    this.orientation={
      yaw:wrap(snapshot.orientation.yaw+yawDelta),
      pitch:clamp(snapshot.orientation.pitch+pitchDelta,-Math.PI/2,Math.PI/2),
      roll:wrap(snapshot.orientation.roll+rollDelta),
    };
    const orientations=cloneFaceOrientations(snapshot.faceOrientations,snapshot.orientation),warps=cloneWarps(snapshot.warps);
    for(const face of FACE_NAMES){
      if(this.isFaceLocked(face))continue;
      const locks=this.transformLocks?.[face]||emptyTransformLocks(),base=snapshot.faceOrientations[face];
      orientations[face]={
        yaw:locks.yaw?base.yaw:wrap(base.yaw+yawDelta),
        pitch:locks.pitch?base.pitch:clamp(base.pitch+pitchDelta,-Math.PI/2,Math.PI/2),
        roll:locks.roll?base.roll:wrap(base.roll+rollDelta),
      };
      if(!locks.scale&&Math.abs(scale-1)>1e-6)warps[face]=transformWarp(snapshot.warps[face],{scale});
    }
    this.faceOrientations=orientations;
    this.faceWarps=warps;
  }

  applyOrientationDelta(yawDelta=0,pitchDelta=0,rollDelta=0){
    const targets=this.mode==="global"?FACE_NAMES:[this.currentFace()];
    let changed=false;
    for(const face of targets){
      if(this.isFaceLocked(face))continue;
      const locks=this.transformLocks?.[face]||emptyTransformLocks(),base=this.effectiveOrientation(face),next={...base};
      if(yawDelta&&!locks.yaw){next.yaw=wrap(base.yaw+yawDelta);changed=true;}
      if(pitchDelta&&!locks.pitch){next.pitch=clamp(base.pitch+pitchDelta,-Math.PI/2,Math.PI/2);changed=true;}
      if(rollDelta&&!locks.roll){next.roll=wrap(base.roll+rollDelta);changed=true;}
      this.faceOrientations[face]=next;
    }
    if(!changed)return false;
    if(this.mode==="global"){
      this.orientation={yaw:wrap(this.orientation.yaw+yawDelta),pitch:clamp(this.orientation.pitch+pitchDelta,-Math.PI/2,Math.PI/2),roll:wrap(this.orientation.roll+rollDelta)};
    }
    this.changed();
    return true;
  }

  pointerMove(event){
    if(!this.activePointers.has(event.pointerId))return;
    event.preventDefault();
    const raw=this.rawPointerPosition(event);this.activePointers.set(event.pointerId,raw);

    if(this.activePointers.size>=2&&this.gesture){
      const a=this.activePointers.get(this.gesture.ids[0]),b=this.activePointers.get(this.gesture.ids[1]);if(!a||!b)return;
      const centroid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),angle=Math.atan2(b.y-a.y,b.x-a.x);
      const dx=centroid.x-this.gesture.startCentroid.x,dy=centroid.y-this.gesture.startCentroid.y;
      const scale=clamp(distance/this.gesture.startDistance,.25,4),rotation=normaliseAngleDelta(angle-this.gesture.startAngle);

      if(this.gesture.mode==="global"){
        const sensitivity=.045*DEG;
        this.applyGlobalSnapshot(this.gesture,{yawDelta:dx*sensitivity,pitchDelta:-dy*sensitivity,rollDelta:rotation,scale});
      }else{
        const face=FACE_NAMES[this.gesture.faceIndex],locks=this.transformLocks?.[face]||emptyTransformLocks();
        this.faceWarps=cloneWarps(this.gesture.warps);
        const tx=locks.move?0:dx/this.canvas.width,ty=locks.move?0:dy/this.canvas.height;
        this.faceWarps[face]=transformWarp(this.gesture.warps[face],{scale:locks.scale?1:scale,angle:locks.rotate?0:rotation,tx,ty});
      }
      this.changed();return;
    }

    if(this.drag?.kind==="global"&&this.drag.pointerId===event.pointerId){
      const dx=raw.x-this.drag.start.x,dy=raw.y-this.drag.start.y,sensitivity=.045*DEG;
      this.applyGlobalSnapshot({orientation:this.drag.orientation,faceOrientations:this.drag.faceOrientations,warps:this.drag.warps},{yawDelta:dx*sensitivity,pitchDelta:-dy*sensitivity});
      this.changed();return;
    }
    super.pointerMove(event);
  }

  zoomView(factor){
    const f=clamp(Number(factor)||1,.5,2),snapshot=cloneWarps(this.faceWarps),targets=this.mode==="global"?FACE_NAMES:[this.currentFace()];
    let changed=false;
    for(const face of targets){
      if(this.isFaceLocked(face)||this.isTransformLocked(face,"scale"))continue;
      this.faceWarps[face]=transformWarp(snapshot[face],{scale:f});changed=true;
    }
    this.viewZoom=1;
    if(changed)this.changed();else this.draw();
  }

  onWheel(event){
    if(this.root.hidden||!this.canvas.contains(event.target))return;
    event.preventDefault();
    const scale=event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:event.deltaMode===WheelEvent.DOM_DELTA_PAGE?240:1;
    const dx=clamp(event.deltaX*scale,-240,240),dy=clamp(event.deltaY*scale,-240,240);
    if(event.altKey){this.zoomView(Math.exp(-dy*.0015));return;}
    const sensitivity=.010*DEG;
    if(event.shiftKey)this.applyOrientationDelta(0,0,dy*sensitivity);
    else if(event.ctrlKey||event.metaKey)this.applyOrientationDelta(dy*sensitivity,0,0);
    else this.applyOrientationDelta(dx*sensitivity,dy*sensitivity,0);
  }

  onKeyDown(event){
    if(this.root.hidden||isEditableTarget(event.target))return;
    const key=String(event.key||"").toLowerCase(),fine=event.shiftKey?.05:.25,step=fine*DEG;
    let delta=null;
    if(key==="arrowleft"||key==="a")delta=[-step,0,0];
    else if(key==="arrowright"||key==="d")delta=[step,0,0];
    else if(key==="arrowup"||key==="w")delta=[0,step,0];
    else if(key==="arrowdown"||key==="s")delta=[0,-step,0];
    else if(key==="q")delta=[0,0,-step];
    else if(key==="e")delta=[0,0,step];
    else if(key==="+"||key==="="){this.zoomView(1.12);event.preventDefault();return;}
    else if(key==="-"||key==="_"){this.zoomView(1/1.12);event.preventDefault();return;}
    else if(key==="escape"){this.close();event.preventDefault();return;}
    if(!delta)return;
    event.preventDefault();this.applyOrientationDelta(...delta);
  }

  drawFace(){
    // The scan photograph is the immutable registration target. Only worker-generated
    // internet artwork previews and their mapping parameters are ever manipulated.
    this.viewZoom=1;
    BaseReferenceAlignmentModal.prototype.drawFace.call(this);
  }

  updateReadout(){
    const face=this.currentFace(),orientation=this.effectiveOrientation(face),warp=this.faceWarps?.[face]||emptyWarp(),maxWarp=Math.max(...warp.points.map(p=>Math.hypot(p[0],p[1]))),scale=estimatedScale(warp);
    const fmt=(value)=>{const n=Number(value||0)*180/Math.PI;return`${n>=0?"+":""}${n.toFixed(1)}°`;};
    this.readoutEl.textContent=`${face}${this.isFaceLocked(face)?" · LOCKED":""} · yaw ${fmt(orientation.yaw)} · pitch ${fmt(orientation.pitch)} · roll ${fmt(orientation.roll)} · local warp ${(maxWarp*100).toFixed(1)}% · overlay scale ~${scale.toFixed(2)}×`;
  }

  renderDiagnostics(){
    BaseReferenceAlignmentModal.prototype.renderDiagnostics.call(this);
    const tbody=this.diagnosticsEl?.querySelector("tbody");
    if(!tbody)return;
    const rows=new Map([...tbody.querySelectorAll("tr")].map(row=>[row.cells?.[0]?.textContent,row]));
    for(const face of DISPLAY_FACE_ORDER){const row=rows.get(face);if(row)tbody.appendChild(row);}
  }
}
