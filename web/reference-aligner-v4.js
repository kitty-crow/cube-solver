import { ReferenceAlignmentModal as LockingReferenceAlignmentModal } from "./reference-aligner-v3.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const emptyWarp=()=>({points:Array.from({length:9},()=>[0,0])});

export class ReferenceAlignmentModal extends LockingReferenceAlignmentModal{
  makeRoot(){
    const root=super.makeRoot();
    const existing=root.querySelector("[data-align-reset-face]");
    if(existing){
      existing.textContent="Reset selected face";
      existing.setAttribute("aria-label","Reset selected face to the current global artwork alignment");
    }

    const faceLock=root.querySelector("[data-align-face-lock]");
    const toolbar=faceLock?.closest(".reference-aligner__toolbar");
    if(toolbar&&!toolbar.querySelector("[data-align-reset-face-top]")){
      const reset=document.createElement("button");
      reset.type="button";
      reset.className="pages-button";
      reset.dataset.alignResetFaceTop="";
      reset.textContent="Reset face";
      reset.setAttribute("aria-label","Reset selected face to the current global artwork alignment");
      reset.addEventListener("click",()=>this.resetFace());
      toolbar.insertBefore(reset,faceLock);
    }
    return root;
  }

  resetFace(){
    const face=FACE_NAMES[this.faceIndex];
    if(this.isFaceLocked(face)){
      this.statusEl.textContent=`Unlock ${face} before resetting it`;
      return;
    }

    // A face reset is local recovery, not a full return to the automatic fit.
    // Keep the current global globe alignment, but discard every local distortion
    // accumulated on this face so the user can start its fine alignment again.
    this.faceWarps[face]=emptyWarp();
    this.faceOrientations[face]=cloneOrientation(this.orientation);
    this.drag=null;
    this.gesture=null;
    this.changed();
    this.statusEl.textContent=`${FACE_LABELS[face]} reset to the current global alignment`;
  }

  ensureWorker(){
    this.worker?.terminate?.();
    this.worker=new Worker(new URL("./reference-adjust-worker.js",import.meta.url),{type:"module"});
    this.worker.addEventListener("message",event=>this.workerMessage(event.data||{}));
    this.worker.addEventListener("error",event=>this.showError(event.message||"Reference adjustment worker failed"));
  }
}
