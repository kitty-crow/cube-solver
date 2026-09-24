import { ReferenceAlignmentModal as ContinuousReferenceAlignmentModal } from "./reference-aligner-v8.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class ReferenceAlignmentModal extends ContinuousReferenceAlignmentModal{
  patchProjection(projection){
    if(!projection)return projection;
    const sourceScale=clamp(Number(projection.sourceScale??projection.orientation?.scale??this.sourceScale??1)||1,.05,20);
    projection.mappingVersion=5;
    projection.sourceScale=sourceScale;
    projection.orientation={...(projection.orientation||{}),scale:sourceScale};
    projection.surfacePartition="connected-cube-surface";
    projection.sourceOverlapAllowed=false;
    projection.sourceOverlapFraction=0;
    projection.seamPinned=true;
    projection.noStretchClamping=true;
    projection.fullSourceResampling=true;
    projection.unboundedInteriorSampling=true;
    projection.unboundedCubeRotation=true;
    projection.faceDomainClippedFraction=0;
    projection.minResidualAttenuation=1;
    return projection;
  }

  async handleLockedWorkerMessage(msg){
    // Patch the worker response BEFORE the inherited commit handler persists the
    // candidate. The v3 worker predates mappingVersion 5 and otherwise labels a
    // freshly corrected mapping as legacy, causing it to be migrated/reset on
    // the next reload.
    if(msg?.projection)this.patchProjection(msg.projection);
    if(msg?.candidate?.projection)this.patchProjection(msg.candidate.projection);
    await super.handleLockedWorkerMessage(msg);
  }
}
