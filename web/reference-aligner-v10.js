import { ReferenceAlignmentModal as CommitSafeReferenceAlignmentModal } from "./reference-aligner-v9.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const emptyWarp=()=>({points:Array.from({length:9},()=>[0,0])});

export class ReferenceAlignmentModal extends CommitSafeReferenceAlignmentModal{
  async open(options={}){
    await super.open(options);
    if(!this.migratedLegacyMapping)return;

    // During migration the first loaded preview may still be the old stretched
    // 0.8.x bitmap. Sanitize both the mapping parameters and immutable lock
    // snapshots, but deliberately DO NOT preserve that stale preview bitmap.
    // The next worker preview is rebuilt from the complete original source.
    this.faceWarps=Object.fromEntries(FACE_NAMES.map(face=>[face,emptyWarp()]));
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)]));
    this.lastRenderedProjection={
      orientation:cloneOrientation(this.orientation),
      faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)])),
      faceWarps:Object.fromEntries(FACE_NAMES.map(face=>[face,emptyWarp()])),
    };
    this.lockedFaceSnapshots={};
    for(const face of FACE_NAMES){
      if(!this.isFaceLocked(face))continue;
      this.lockedFaceSnapshots[face]={
        orientation:cloneOrientation(this.orientation),
        warp:emptyWarp(),
        previewImage:null,
      };
    }
    this.changed();
    this.statusEl.textContent="Upgraded old mapping: preserved cube placement and removed legacy face-edge stretching";
  }
}
