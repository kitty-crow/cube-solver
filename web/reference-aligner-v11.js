import { ReferenceAlignmentModal as SurfaceReferenceAlignmentModal } from "./reference-aligner-v10.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const cloneWarp=(value)=>({points:Array.from({length:9},(_,i)=>{const p=value?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];})});

export class ReferenceAlignmentModal extends SurfaceReferenceAlignmentModal{
  async open(options={}){
    const storedVersion=Number(options.draft?.mappingVersion??options.draft?.projection?.mappingVersion??options.candidate?.projection?.mappingVersion??0);
    await super.open(options);

    if(storedVersion>=6)return;

    // 0.9.0 saved preview bitmaps were rendered with an infinite tangent-plane
    // continuation. Near a face edge that projection converged on a horizon and
    // visibly smeared. Keep the user's actual pose/refinement parameters, but
    // NEVER freeze/reuse those old rendered pixels. Re-render every face from
    // the original reference through the new cube-edge folding topology.
    this.previewImages=[];
    this.lastRenderedProjection={
      orientation:{...cloneOrientation(this.orientation),scale:Number(this.sourceScale||1)},
      sourceScale:Number(this.sourceScale||1),
      faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.faceOrientations?.[face]||this.orientation)])),
      faceWarps:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(this.faceWarps?.[face])])),
      mappingVersion:6,
      crossFaceContinuation:true,
    };
    this.lockedFaceSnapshots={};
    for(const face of FACE_NAMES){
      if(!this.isFaceLocked(face))continue;
      this.lockedFaceSnapshots[face]={
        orientation:cloneOrientation(this.faceOrientations?.[face]||this.orientation),
        warp:cloneWarp(this.faceWarps?.[face]),
        previewImage:null,
      };
    }
    this.schedulePreview(0);
    this.draw();
    this.statusEl.textContent="Re-rendering saved mapping with true cross-face continuation";
  }

  draftState(){
    return{
      ...super.draftState(),
      mappingVersion:6,
      crossFaceContinuation:true,
      infinitePlaneProjection:false,
    };
  }

  adjustmentPayload(){
    const payload=super.adjustmentPayload();
    return{
      ...payload,
      mappingVersion:6,
      crossFaceContinuation:true,
      infinitePlaneProjection:false,
      topology:{
        ...(payload.topology||{}),
        crossFaceContinuation:true,
        infinitePlaneProjection:false,
        edgeStretchAllowed:false,
        unboundedCubeRotation:true,
      },
    };
  }

  patchProjection(projection){
    const patched=super.patchProjection(projection);
    if(!patched)return patched;
    patched.mappingVersion=6;
    patched.crossFaceContinuation=true;
    patched.infinitePlaneProjection=false;
    patched.unboundedCubeRotation=true;
    patched.topology={
      ...(patched.topology||{}),
      crossFaceContinuation:true,
      infinitePlaneProjection:false,
      edgeStretchAllowed:false,
      unboundedCubeRotation:true,
    };
    return patched;
  }
}
