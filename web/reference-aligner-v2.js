import { ReferenceAlignmentModal as BaseReferenceAlignmentModal } from "./reference-aligner.js";

export class ReferenceAlignmentModal extends BaseReferenceAlignmentModal {
  makeRoot() {
    const root = super.makeRoot();
    const globalMode = root.querySelector('[data-align-mode="global"]');
    if (globalMode) globalMode.textContent = "Rotate artwork";
    return root;
  }
}
