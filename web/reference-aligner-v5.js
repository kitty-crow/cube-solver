import { ReferenceAlignmentModal as RecoveryReferenceAlignmentModal } from "./reference-aligner-v4.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};

const cloneOrientation=(value)=>({
  yaw:Number(value?.yaw||0),
  pitch:Number(value?.pitch||0),
  roll:Number(value?.roll||0),
});
const cloneWarp=(value)=>({points:Array.from({length:9},(_,i)=>{
  const p=value?.points?.[i]||[0,0];
  return[Number(p[0])||0,Number(p[1])||0];
})});
const cloneProjection=(value)=>({
  orientation:cloneOrientation(value?.orientation),
  faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.faceOrientations?.[face]||value?.orientation)])),
  faceWarps:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(value?.faceWarps?.[face])])),
});

export class ReferenceAlignmentModal extends RecoveryReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    this.lockedFaceSnapshots={};
    this.lastRenderedProjection=null;
    this.lockMessageQueue=Promise.resolve();
  }

  async open(options={}){
    this.lockedFaceSnapshots={};
    this.lastRenderedProjection=cloneProjection(options.candidate?.projection||{});
    this.lockMessageQueue=Promise.resolve();
    await super.open(options);
    for(const face of FACE_NAMES){
      if(this.isFaceLocked(face))this.lockedFaceSnapshots[face]=this.captureFaceSnapshot(face);
    }
    this.restoreLockedFaces();
    this.draw();
  }

  captureFaceSnapshot(face){
    const rendered=this.lastRenderedProjection;
    const orientation=rendered?.faceOrientations?.[face]||this.faceOrientations?.[face]||this.orientation;
    const warp=rendered?.faceWarps?.[face]||this.faceWarps?.[face];
    const previewImage=this.previewImages?.[FACE_NAMES.indexOf(face)]||null;
    return{orientation:cloneOrientation(orientation),warp:cloneWarp(warp),previewImage};
  }

  ensureLockedSnapshot(face){
    if(!this.lockedFaceSnapshots[face])this.lockedFaceSnapshots[face]=this.captureFaceSnapshot(face);
    return this.lockedFaceSnapshots[face];
  }

  restoreLockedFaces(){
    if(!this.lockedFaceSnapshots)return;
    for(const face of FACE_NAMES){
      if(!this.isFaceLocked(face))continue;
      const snapshot=this.ensureLockedSnapshot(face);
      this.faceOrientations[face]=cloneOrientation(snapshot.orientation);
      this.faceWarps[face]=cloneWarp(snapshot.warp);
    }
  }

  restoreLockedPreviews(){
    if(!this.previewImages?.length)return;
    for(const face of FACE_NAMES){
      if(!this.isFaceLocked(face))continue;
      const snapshot=this.lockedFaceSnapshots?.[face];
      if(snapshot?.previewImage)this.previewImages[FACE_NAMES.indexOf(face)]=snapshot.previewImage;
    }
  }

  toggleFaceLock(){
    const face=this.currentFace();
    if(this.isFaceLocked(face)){
      this.faceLocks[face]=false;
      delete this.lockedFaceSnapshots[face];
      this.statusEl.textContent=`${FACE_LABELS[face]} unlocked`;
    }else{
      const snapshot=this.captureFaceSnapshot(face);
      this.faceOrientations[face]=cloneOrientation(snapshot.orientation);
      this.faceWarps[face]=cloneWarp(snapshot.warp);
      this.lockedFaceSnapshots[face]=snapshot;
      this.faceLocks[face]=true;
      this.statusEl.textContent=`${FACE_LABELS[face]} locked at its current mapping`;
    }
    this.drag=null;
    this.gesture=null;
    this.activePointers?.clear?.();
    this.updateLockControls();
    this.setMode(this.mode);
    this.changed();
  }

  changed(){
    this.restoreLockedFaces();
    super.changed();
  }

  schedulePreview(delay=24){
    this.restoreLockedFaces();
    return super.schedulePreview(delay);
  }

  requestCommit(action){
    this.restoreLockedFaces();
    return super.requestCommit(action);
  }

  workerMessage(msg){
    this.lockMessageQueue=this.lockMessageQueue.catch(()=>{}).then(()=>this.handleLockedWorkerMessage(msg));
    return this.lockMessageQueue;
  }

  async handleLockedWorkerMessage(msg){
    await super.workerMessage(msg);
    if(msg.type==="reference-adjust-preview"){
      const requestId=Number(msg.requestId||0);
      if(requestId===Number(this.latestPreviewId||0)&&msg.projection){
        this.lastRenderedProjection=cloneProjection(msg.projection);
      }
      this.restoreLockedFaces();
      this.restoreLockedPreviews();
      if(!this.root.hidden)this.draw();
    }
  }
}
