import { ReferenceAlignmentModal as LockingReferenceAlignmentModal } from "./reference-aligner-v3.js";

export class ReferenceAlignmentModal extends LockingReferenceAlignmentModal{
  ensureWorker(){
    this.worker?.terminate?.();
    this.worker=new Worker(new URL("./reference-adjust-worker.js",import.meta.url),{type:"module"});
    this.worker.addEventListener("message",event=>this.workerMessage(event.data||{}));
    this.worker.addEventListener("error",event=>this.showError(event.message||"Reference adjustment worker failed"));
  }
}
