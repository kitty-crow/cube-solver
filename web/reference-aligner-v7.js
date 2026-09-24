import { ReferenceAlignmentModal as AllowedReferenceAlignmentModal } from "./reference-aligner-v6.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const TRANSFORM_KEYS=["move","rotate","scale","warp","yaw","pitch","roll"];

const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const cloneWarp=(value)=>({points:Array.from({length:9},(_,i)=>{const p=value?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];})});
const cloneWarps=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(value?.[face])]));
const cloneFaceOrientations=(value,fallback)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.[face]||fallback)]));
const cloneFaceLocks=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Boolean(Array.isArray(value)?value.includes(face):value?.[face])]));
const cloneTransformAllows=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,value?.[face]?.[key]!==false]))]));

export class ReferenceAlignmentModal extends AllowedReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    this.onDraft=options.onDraft||(()=>{});
    this.draftTimer=null;
  }

  ensureWorker(){
    this.worker?.terminate?.();
    this.worker=new Worker(new URL("./reference-adjust-worker-v3.js",import.meta.url),{type:"module"});
    this.worker.addEventListener("message",event=>this.workerMessage(event.data||{}));
    this.worker.addEventListener("error",event=>this.showError(event.message||"Reference adjustment worker failed"));
  }

  makeRoot(){
    const root=super.makeRoot();
    const globalButton=root.querySelector('[data-align-mode="global"]');
    const faceButton=root.querySelector('[data-align-mode="face"]');
    if(globalButton)globalButton.textContent="Align cube wrap";
    if(faceButton)faceButton.textContent="Refine selected face";
    const label=root.querySelector(".reference-aligner__lockbar-label");
    if(label)label.textContent="Allowed adjustments:";
    return root;
  }

  anyFaceLocked(){return FACE_NAMES.some(face=>this.isFaceLocked(face));}

  async open(options={}){
    await super.open(options);
    const draft=options.draft;
    if(draft){
      this.orientation=cloneOrientation(draft.orientation||draft.projection?.orientation||this.orientation);
      this.faceOrientations=cloneFaceOrientations(draft.faceOrientations||draft.projection?.faceOrientations,this.orientation);
      this.faceWarps=cloneWarps(draft.faceWarps||draft.projection?.faceWarps||this.faceWarps);
      this.faceLocks=cloneFaceLocks(draft.lockedFaces||draft.projection?.lockedFaces||this.faceLocks);
      this.transformAllows=cloneTransformAllows(draft.transformAllows||draft.projection?.transformAllows||this.transformAllows);
      if(Number.isInteger(draft.faceIndex))this.faceIndex=Math.max(0,Math.min(5,draft.faceIndex));
      else if(draft.face&&FACE_NAMES.includes(draft.face))this.faceIndex=FACE_NAMES.indexOf(draft.face);
      if(Number.isFinite(Number(draft.opacity))){this.opacity=Math.max(0,Math.min(1,Number(draft.opacity)));this.opacityInput.value=String(this.opacity);this.opacityValue.textContent=`${Math.round(this.opacity*100)}%`;}
      this.syncLegacyLocks();
      this.lockedFaceSnapshots={};
      this.lastRenderedProjection={orientation:cloneOrientation(this.orientation),faceOrientations:cloneFaceOrientations(this.faceOrientations,this.orientation),faceWarps:cloneWarps(this.faceWarps)};
      for(const face of FACE_NAMES)if(this.isFaceLocked(face))this.lockedFaceSnapshots[face]=this.captureFaceSnapshot(face);
      this.setFace(this.faceIndex);
      this.setMode(draft.mode==="face"?"face":(options.initialMode==="face"?"face":"global"));
      this.updateLockControls();
      this.draw();
      this.schedulePreview(0);
      this.statusEl.textContent="Restored saved cube-wrap mapping";
    }
  }

  draftState(){
    return{
      version:2,
      mappingVersion:4,
      surfacePartition:"connected-cube-surface",
      orientation:cloneOrientation(this.orientation),
      faceOrientations:cloneFaceOrientations(this.faceOrientations,this.orientation),
      faceWarps:cloneWarps(this.faceWarps),
      lockedFaces:cloneFaceLocks(this.faceLocks),
      transformAllows:cloneTransformAllows(this.transformAllows),
      opacity:Number(this.opacity||0),
      faceIndex:Number(this.faceIndex||0),
      mode:this.mode==="face"?"face":"global",
      savedAt:Date.now(),
    };
  }

  queueDraft(){
    clearTimeout(this.draftTimer);
    this.draftTimer=setTimeout(()=>{
      this.draftTimer=null;
      if(!this.candidate)return;
      Promise.resolve(this.onDraft(this.draftState())).catch(error=>console.warn("Could not autosave reference mapping",error));
    },100);
  }

  changed(){
    super.changed();
    this.queueDraft();
  }

  adjustmentPayload(){
    const payload=super.adjustmentPayload();
    return{
      ...payload,
      topology:{
        kind:"connected-cube-surface",
        rigidGlobalPose:true,
        sharedSeams:true,
        independentFaceCameras:false,
        sourceOverlapAllowed:false,
        edgeStretchAllowed:false,
      },
    };
  }

  setMode(mode){
    super.setMode(mode);
    if(!this.hintEl)return;
    const face=this.currentFace();
    if(this.mode==="global"){
      this.hintEl.textContent="Align one continuous reference around the whole cube. Placement and rotation here move all six connected faces together, so aligning one face should make the others fall into place.";
    }else if(this.isFaceLocked(face)){
      this.hintEl.textContent=`${FACE_LABELS[face]} is locked at its exact mapping. Unlock it before refining it.`;
    }else{
      this.hintEl.textContent="Refine this face only after the global cube wrap is aligned. Local edits are constrained to this face interior; all four seams remain joined to neighbouring faces and over-large edits are reduced as a whole instead of stretching pixels.";
    }
    this.updateLockControls();
  }

  beginSingleDrag(pointerId,raw){
    super.beginSingleDrag(pointerId,raw);
    if(this.mode==="global"&&this.drag&&this.anyFaceLocked()){
      this.drag=null;
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before moving the global cube wrap.";
    }
  }

  beginGesture(){
    super.beginGesture();
    if(this.mode==="global"&&this.gesture&&this.anyFaceLocked()){
      this.gesture=null;this.drag=null;
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before rotating or scaling the global cube wrap.";
    }
  }

  applyGlobalSnapshot(snapshot,change={}){
    if(this.anyFaceLocked())return;
    return super.applyGlobalSnapshot(snapshot,change);
  }

  applyOrientationDelta(yawDelta=0,pitchDelta=0,rollDelta=0){
    if(this.mode==="global"&&this.anyFaceLocked()){
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before changing global cube orientation.";
      return false;
    }
    return super.applyOrientationDelta(yawDelta,pitchDelta,rollDelta);
  }

  async handleLockedWorkerMessage(msg){
    await super.handleLockedWorkerMessage(msg);
    if(msg?.projection?.minResidualAttenuation<.999&&msg.type==="reference-adjust-preview"){
      const pct=Math.round(Number(msg.projection.minResidualAttenuation||0)*100);
      this.statusEl.textContent=`Refinement limited to ${pct}% to preserve the connected cube surface without stretching`;
    }
  }

  requestCommit(action){
    this.queueDraft();
    return super.requestCommit(action);
  }

  close(){
    clearTimeout(this.draftTimer);this.draftTimer=null;
    if(this.candidate)Promise.resolve(this.onDraft(this.draftState())).catch(()=>{});
    return super.close();
  }
}
