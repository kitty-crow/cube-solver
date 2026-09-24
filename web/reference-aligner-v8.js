import { ReferenceAlignmentModal as ConnectedReferenceAlignmentModal } from "./reference-aligner-v7.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const GLOBAL_KEYS=new Set(["move","rotate","scale","yaw","pitch","roll"]);
const TAU=Math.PI*2;

const wrap=(v)=>{let x=Number(v||0)%TAU;if(x<0)x+=TAU;return x;};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const emptyWarp=()=>({points:Array.from({length:9},()=>[0,0])});
const cloneWarp=(value)=>({points:Array.from({length:9},(_,i)=>{const p=value?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];})});
const cloneWarps=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(value?.[face])]));
const cloneFaceOrientations=(value,fallback)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.[face]||fallback)]));

export class ReferenceAlignmentModal extends ConnectedReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    this.sourceScale=1;
    this.migratedLegacyMapping=false;
  }

  async open(options={}){
    this.migratedLegacyMapping=false;
    await super.open(options);
    const draft=options.draft||null;
    const projection=draft?.projection||options.candidate?.projection||{};
    this.sourceScale=clamp(Number(draft?.sourceScale??projection.sourceScale??projection.orientation?.scale??1)||1,.05,20);

    if(Number(projection.mappingVersion||0)<5){
      this.faceWarps=Object.fromEntries(FACE_NAMES.map(face=>[face,emptyWarp()]));
      this.faceOrientations=Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)]));
      this.lockedFaceSnapshots={};
      for(const face of FACE_NAMES)if(this.isFaceLocked(face))this.lockedFaceSnapshots[face]=this.captureFaceSnapshot(face);
      this.migratedLegacyMapping=true;
      this.changed();
      this.statusEl.textContent="Upgraded old mapping: preserved cube placement and removed legacy face-edge stretching";
    }else{
      this.schedulePreview(0);
    }
    this.setMode(this.mode);
    this.updateLockControls();
    this.draw();
  }

  draftState(){
    return{
      ...super.draftState(),
      version:3,
      mappingVersion:5,
      sourceScale:this.sourceScale,
      fullSourceResampling:true,
      unboundedCubeRotation:true,
    };
  }

  adjustmentPayload(){
    const payload=super.adjustmentPayload();
    const global=cloneOrientation(this.orientation);
    const orientation={...global,scale:this.sourceScale};
    return{
      ...payload,
      orientation,
      sourceScale:this.sourceScale,
      faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(global)])),
      mappingVersion:5,
      topology:{
        ...(payload.topology||{}),
        kind:"connected-cube-surface",
        rigidGlobalPose:true,
        sharedSeams:true,
        independentFaceCameras:false,
        sourceOverlapAllowed:false,
        edgeStretchAllowed:false,
        fullSourceResampling:true,
        unboundedInteriorSampling:true,
        unboundedCubeRotation:true,
        crossFaceContinuation:true,
      },
    };
  }

  toggleTransformLock(key){
    if(!GLOBAL_KEYS.has(key))return super.toggleTransformLock(key);
    const next=!this.isTransformAllowed(this.currentFace(),key);
    this.transformAllows??={};
    for(const face of FACE_NAMES){
      this.transformAllows[face]??={};
      this.transformAllows[face][key]=next;
    }
    this.syncLegacyLocks();
    this.updateLockControls();
    this.changed();
  }

  updateLockControls(){
    super.updateLockControls();
    if(!this.root)return;
    const anchored=this.anyFaceLocked();
    for(const button of this.root.querySelectorAll("[data-align-transform-lock]")){
      const key=button.dataset.alignTransformLock;
      if(!GLOBAL_KEYS.has(key))continue;
      const base=button.textContent.replace(/\s*\(cube\)$/i,"");
      button.textContent=`${base} (cube)`;
      button.disabled=anchored;
      if(anchored)button.title="A locked face anchors the connected cube. Unlock all faces before moving, rotating or scaling the global wrap.";
    }
  }

  setMode(mode){
    super.setMode(mode);
    if(!this.hintEl)return;
    const face=this.currentFace();
    if(this.mode==="global"){
      this.hintEl.textContent="Drag continuously to move the complete reference around the cube. Pitch is truly continuous through 90°, 180°, 270° and further turns. Pinch scales the global source and twist rotates it.";
    }else if(this.isFaceLocked(face)){
      this.hintEl.textContent=`${FACE_LABELS[face]} is locked at its exact mapping. Unlock it before editing.`;
    }else{
      this.hintEl.textContent="This face is a viewport onto the same complete wrapped image. Crossing a face edge continues onto its physical neighbour instead of approaching a face-local horizon. Only mesh-handle Warp is local to this face.";
    }
    this.updateLockControls();
  }

  beginSingleDrag(pointerId,raw){
    super.beginSingleDrag(pointerId,raw);
    if(!this.drag)return;
    if(this.drag.kind==="handle")return;
    if(this.anyFaceLocked()||!this.isTransformAllowed(this.currentFace(),"move")){
      this.drag=null;
      this.statusEl.textContent=this.anyFaceLocked()?"A locked face anchors the cube pose. Unlock all faces before moving the wrap.":"Translation is disabled for the cube wrap.";
      return;
    }
    this.drag.kind="global";
    this.drag.orientation=cloneOrientation(this.orientation);
    this.drag.faceOrientations=cloneFaceOrientations(this.faceOrientations,this.orientation);
    this.drag.warps=cloneWarps(this.faceWarps);
    this.drag.sourceScale=this.sourceScale;
  }

  beginGesture(){
    super.beginGesture();
    if(!this.gesture)return;
    if(this.anyFaceLocked()){
      this.gesture=null;this.drag=null;
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before transforming the wrap.";
      return;
    }
    this.gesture.mode="global";
    this.gesture.sourceScale=this.sourceScale;
  }

  applyGlobalSnapshot(snapshot,{yawDelta=0,pitchDelta=0,rollDelta=0,scale=1}={}){
    if(this.anyFaceLocked())return false;
    const face=this.currentFace();
    const allowMove=this.isTransformAllowed(face,"move");
    const allowYaw=this.isTransformAllowed(face,"yaw");
    const allowPitch=this.isTransformAllowed(face,"pitch");
    const allowRotate=this.isTransformAllowed(face,"rotate");
    const allowRoll=this.isTransformAllowed(face,"roll");
    const allowScale=this.isTransformAllowed(face,"scale");
    const base=cloneOrientation(snapshot.orientation||this.orientation);
    const y=allowMove&&allowYaw?yawDelta:0;
    const p=allowMove&&allowPitch?pitchDelta:0;
    const r=allowRotate&&allowRoll?rollDelta:0;
    // DO NOT normalise pitch. A wrapped Euler angle is harmless mathematically,
    // but it makes a continuous drag jump representation after a half-turn and
    // can make the UI feel as though it has hit a pole. Keep the user's actual
    // accumulated pitch and let sin/cos supply the periodic rotation.
    this.orientation={yaw:wrap(base.yaw+y),pitch:base.pitch+p,roll:wrap(base.roll+r)};
    this.sourceScale=allowScale?clamp(Number(snapshot.sourceScale??this.sourceScale)*Number(scale||1),.05,20):Number(snapshot.sourceScale??this.sourceScale);
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(name=>[name,cloneOrientation(this.orientation)]));
    this.faceWarps=cloneWarps(snapshot.warps||this.faceWarps);
    return true;
  }

  applyOrientationDelta(yawDelta=0,pitchDelta=0,rollDelta=0){
    if(this.anyFaceLocked()){
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before changing orientation.";
      return false;
    }
    const face=this.currentFace(),base=cloneOrientation(this.orientation);
    const y=this.isTransformAllowed(face,"yaw")?yawDelta:0;
    const p=this.isTransformAllowed(face,"pitch")?pitchDelta:0;
    const r=this.isTransformAllowed(face,"roll")&&this.isTransformAllowed(face,"rotate")?rollDelta:0;
    if(!y&&!p&&!r)return false;
    this.orientation={yaw:wrap(base.yaw+y),pitch:base.pitch+p,roll:wrap(base.roll+r)};
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(name=>[name,cloneOrientation(this.orientation)]));
    this.changed();
    return true;
  }

  zoomView(factor){
    if(this.anyFaceLocked()||!this.isTransformAllowed(this.currentFace(),"scale"))return this.draw();
    this.sourceScale=clamp(this.sourceScale*(Number(factor)||1),.05,20);
    this.viewZoom=1;
    this.changed();
  }

  resetFace(){
    const face=this.currentFace();
    if(this.isFaceLocked(face)){
      this.statusEl.textContent=`Unlock ${face} before resetting it`;
      return;
    }
    this.faceWarps[face]=emptyWarp();
    this.faceOrientations[face]=cloneOrientation(this.orientation);
    this.changed();
    this.statusEl.textContent=`${FACE_LABELS[face]} local Warp reset; global cube placement preserved`;
  }

  resetAll(){
    if(this.anyFaceLocked()){
      for(const face of FACE_NAMES)if(!this.isFaceLocked(face))this.faceWarps[face]=emptyWarp();
      this.changed();
      this.statusEl.textContent="Unlocked local Warp refinements reset. Locked face keeps the global cube pose anchored.";
      return;
    }
    this.orientation=cloneOrientation(this.autoOrientation);
    this.sourceScale=1;
    this.faceWarps=Object.fromEntries(FACE_NAMES.map(face=>[face,emptyWarp()]));
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)]));
    this.changed();
    this.statusEl.textContent="Whole cube wrap reset to automatic alignment";
  }

  async handleLockedWorkerMessage(msg){
    await super.handleLockedWorkerMessage(msg);
    const scale=Number(msg?.projection?.sourceScale??msg?.projection?.orientation?.scale);
    if(Number.isFinite(scale)&&scale>0)this.sourceScale=clamp(scale,.05,20);
  }

  updateReadout(){
    super.updateReadout();
    if(this.readoutEl)this.readoutEl.textContent+=` · source ${this.sourceScale.toFixed(3)}× · cross-face continuation · no face-edge horizon`;
  }
}
