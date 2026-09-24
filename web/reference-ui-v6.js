import { ReferenceAssistant as PersistedReferenceAssistant } from "./reference-ui-v4.js";
import { ReferenceAlignmentModal } from "./reference-aligner-v10.js";

export class ReferenceAssistant extends PersistedReferenceAssistant{
  constructor(options={}){
    super(options);
    this.aligner?.close?.();
    this.aligner?.root?.remove?.();
    this.aligner=new ReferenceAlignmentModal({
      onStatus:(message)=>{if(message)this.statusEl.textContent=message;},
      onDraft:(draft)=>this.queueDraftPersistence(draft),
      onCommit:async(candidate)=>{
        if(!this.result||this.selectedIndex<0)return;
        this.restoredDraft=null;
        this.result.candidates[this.selectedIndex]=candidate;
        this.render();
        await this.persistSelected();
        window.dispatchEvent(new CustomEvent("picture-reference-ready"));
      },
    });
  }
}
