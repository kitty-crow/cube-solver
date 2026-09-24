import { ReferenceAssistant as PersistedReferenceAssistant } from "./reference-ui-v4.js";
import { ReferenceAlignmentModal } from "./reference-aligner-v13.js";
import { StickerIdentificationModal } from "./sticker-identification-ui-v2.js";
import { loadReferenceSession, saveReferenceSession } from "./reference-session.js";

export class ReferenceAssistant extends PersistedReferenceAssistant{
  constructor(options={}){
    super(options);
    this.identificationState=null;
    this.aligner?.close?.();
    this.aligner?.root?.remove?.();
    this.aligner=new ReferenceAlignmentModal({
      onStatus:(message)=>{if(message)this.statusEl.textContent=message;},
      onDraft:(draft)=>this.queueDraftPersistence(draft),
      onDraftImmediate:(draft)=>{
        this.restoredDraft=draft?structuredClone(draft):null;
        clearTimeout(this.draftSaveTimer);
        return this.persistSessionOnly(this.restoredDraft);
      },
      onCommit:async(candidate)=>{
        if(!this.result||this.selectedIndex<0)return;
        this.restoredDraft=null;
        this.identificationState=null;
        this.identifier?.close?.();
        this.result.candidates[this.selectedIndex]=candidate;
        this.render();
        await this.persistIdentificationState(null);
        await this.persistSelected();
        window.dispatchEvent(new CustomEvent("picture-reference-ready"));
      },
    });
    this.identifier=new StickerIdentificationModal({
      onStatus:(message)=>{if(message)this.statusEl.textContent=message;},
      onChange:(state)=>{
        this.identificationState=state?structuredClone(state):null;
        this.renderIdentificationControl();
        return this.persistIdentificationState(this.identificationState);
      },
      onResolved:async(state)=>{
        this.identificationState=state?structuredClone(state):null;
        await this.persistIdentificationState(this.identificationState);
        await this.persistSelected();
        this.renderIdentificationControl();
        window.dispatchEvent(new CustomEvent("picture-stickers-resolved",{detail:{state:this.identificationState}}));
      },
    });
  }

  invalidate(){
    this.identifier?.close?.();
    this.identificationState=null;
    super.invalidate();
  }

  async clearPersistedSession(){
    this.identifier?.close?.();
    this.identificationState=null;
    return super.clearPersistedSession();
  }

  async matchCandidate(index){
    const changing=index!==this.selectedIndex;
    if(changing){
      this.identifier?.close?.();
      this.identificationState=null;
    }
    const candidate=await super.matchCandidate(index);
    if(changing&&candidate?.usable)await this.persistIdentificationState(null);
    this.renderIdentificationControl();
    return candidate;
  }

  async restorePersisted(payload){
    const restored=await super.restorePersisted(payload);
    if(!restored)return false;
    const session=await loadReferenceSession(payload).catch(()=>null);
    this.identificationState=session?.identificationState||null;
    this.renderIdentificationControl();
    if(this.identificationState?.resolved?.resolved){
      this.statusEl.textContent="Restored saved reference and uniquely identified scramble.";
    }
    return true;
  }

  async persistIdentificationState(state=this.identificationState){
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate||!this.lastPayload)return false;
    return saveReferenceSession({
      payload:this.lastPayload,
      result:this.result,
      selectedIndex:this.selectedIndex,
      candidate,
      draft:this.restoredDraft,
      editorState:this.restoredDraft?{mode:this.restoredDraft.mode||"global",face:this.restoredDraft.face||"F"}:null,
      identificationState:state,
    });
  }

  selectedEvidence(){
    const evidence=super.selectedEvidence();
    if(!evidence)return null;
    if(this.identificationState){
      evidence.reference={
        ...(evidence.reference||{}),
        manual_identification_session:{
          version:Number(this.identificationState.version||1),
          confirmations:this.identificationState.confirmations||{},
          summary:this.identificationState.summary||null,
        },
      };
      if(this.identificationState.resolved?.resolved){
        evidence.reference.manual_identification=structuredClone(this.identificationState.resolved);
      }
    }
    return evidence;
  }

  identificationResolved(){return Boolean(this.identificationState?.resolved?.resolved);}

  async openStickerIdentification(){
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate||!this.lastPayload)throw new Error("Choose and align a reference before identifying the scramble.");
    await this.identifier.open({candidate,payload:this.lastPayload,state:this.identificationState});
  }

  render(){
    super.render();
    this.renderIdentificationControl();
  }

  renderIdentificationControl(){
    if(!this.sixWrap)return;
    let tools=this.sixWrap.querySelector("[data-sticker-identify-tools]");
    if(!tools){
      tools=document.createElement("div");
      tools.className="reference-aligner-launch";
      tools.dataset.stickerIdentifyTools="";
      const button=document.createElement("button");
      button.type="button";
      button.className="pages-button pages-button--primary";
      button.dataset.stickerIdentifyOpen="";
      button.addEventListener("click",()=>this.openStickerIdentification().catch(error=>{this.statusEl.textContent=error instanceof Error?error.message:String(error);}));
      const note=document.createElement("p");
      note.className="reference-aligner-launch__note";
      note.dataset.stickerIdentifyNote="";
      tools.append(button,note);
      this.sixGrid?.insertAdjacentElement("afterend",tools);
    }
    const candidate=this.result?.candidates?.[this.selectedIndex],button=tools.querySelector("[data-sticker-identify-open]"),note=tools.querySelector("[data-sticker-identify-note]");
    const available=Boolean(candidate?.usable&&Array.isArray(candidate.facePreviews)&&candidate.facePreviews.length===6&&Number(this.lastPayload?.size)===3);
    tools.hidden=!available;if(!available)return;
    const summary=this.identificationState?.summary;
    if(this.identificationResolved()){
      button.textContent="Review identified scramble";
      note.textContent=`Unique legal scramble · ${summary?.confirmedCount??Object.keys(this.identificationState?.confirmations||{}).length} manually confirmed · remaining stickers inferred mechanically.`;
    }else if(summary){
      button.textContent="Continue identifying stickers";
      const states=Number(summary.legalStateCount||0).toLocaleString();
      note.textContent=`${summary.confirmedCount||0} confirmed · ${summary.inferredCount||0} inferred · ${summary.unresolvedCount||0} unresolved · ${states} legal state${Number(summary.legalStateCount)===1?"":"s"}.`;
    }else{
      button.textContent="Identify scrambled stickers";
      note.textContent="After the solved wrap is aligned, identify only the ambiguous physical stickers. The reference is frozen; this stage permits surface panning and 90° quarter-turns only.";
    }
  }
}
