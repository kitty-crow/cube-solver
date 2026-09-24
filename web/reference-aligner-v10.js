import { ReferenceAlignmentModal as CommitSafeReferenceAlignmentModal } from "./reference-aligner-v9.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const emptyWarp=()=>({points:Array.from({length:9},()=>[0,0])});

export class ReferenceAlignmentModal extends CommitSafeReferenceAlignmentModal{
  async open(options={}){
    await super.open(options);
    if(!this.migratedLegacyMapping)return;

    // captureFaceSnapshot() prefers lastRenderedProjection. During migration the
    // first worker preview may still describe the old 0.8.x face residuals, so a
    // locked face could otherwise restore exactly the stretch we are removing.
    // Replace both the live state and the snapshot source with the sanitised
    // global-wrap state before rebuilding immutable lock snapshots.
    this.faceWarps=Object.fromEntries(FACE_NAMES.map(face=>[face,emptyWarp()]));
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)]));
    this.lastRenderedProjection={
      orientation:cloneOrientation(this.orientation),
      faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)])),
      faceWarps:Object.fromEntries(FACE_NAMES.map(face=>[face,emptyWarp()])),
    };
    this.lockedFaceSnapshots={};
    for(const face of FACE_NAMES)if(this.isFaceLocked(face))this.lockedFaceSnapshots[face]=this.captureFaceSnapshot(face);
    this.changed();
    this.statusEl.textContent="Upgraded old mapping: preserved cube placement and removed legacy face-edge stretching";
  }
}
