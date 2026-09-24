import { ReferenceAssistant as BaseReferenceAssistant } from "./reference-ui-v4.js";
import { ReferenceAlignmentModal } from "./reference-aligner-v7.js";
import {
  loadReferenceSession, saveReferenceSession, fetchReferenceBlob, blobToDataUrl,
} from "./reference-session-store.js";

function clonePlain(value){
  if(value==null)return value;
  try{return structuredClone(value);}catch(_){return JSON.parse(JSON.stringify(value));}
}

export class ReferenceAssistant extends BaseReferenceAssistant{
  constructor(options={}){
    super(options);
    this.aligner?.close?.();
    this.aligner?.root?.remove?.();
    this.mappingDraft=null;
    this.cachedReferenceBlob=null;
    this.cachedReferenceUrl="";
    this.sessionSavePromise=Promise.resolve();
    this.aligner=new ReferenceAlignmentModal({
      onStatus:(message)=>{if(message)this.statusEl.textContent=message;},
      onDraft:(draft)=>{
        this.mappingDraft=clonePlain(draft);
        return this.saveCurrentSession();
      },
      onCommit:async(candidate)=>{
        if(!this.result||this.selectedIndex<0)return;
        this.result.candidates[this.selectedIndex]=candidate;
        this.mappingDraft=null;
        this.render();
        await this.persistSelected();
        window.dispatchEvent(new CustomEvent("picture-reference-ready"));
      },
    });
  }

  selectedEvidence(){
    const evidence=super.selectedEvidence();
    if(!evidence)return null;
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(evidence.reference&&candidate){
      evidence.reference.thumbnail_url=candidate.originalThumbnailUrl||candidate.thumbnailUrl||evidence.reference.thumbnail_url;
      evidence.reference.cached_reference_image=Boolean(this.cachedReferenceBlob);
      evidence.reference.mapping_autosaved=true;
      evidence.reference.surface_partition=candidate.projection?.surfacePartition||evidence.reference.surface_partition||"connected-cube-surface";
      evidence.reference.source_overlap_allowed=false;
      evidence.reference.seam_pinned=candidate.projection?.seamPinned!==false;
      evidence.reference.no_stretch_clamping=candidate.projection?.noStretchClamping!==false;
    }
    return evidence;
  }

  async ensureReferenceBlob(candidate){
    if(!candidate)return null;
    const source=candidate.originalThumbnailUrl||candidate.thumbnailUrl||"";
    if(this.cachedReferenceBlob&&source===this.cachedReferenceUrl)return this.cachedReferenceBlob;
    if(!source||source.startsWith("data:")||source.startsWith("blob:"))return this.cachedReferenceBlob;
    const blob=await fetchReferenceBlob(source);
    if(blob){
      this.cachedReferenceBlob=blob;
      this.cachedReferenceUrl=source;
      candidate.originalThumbnailUrl=source;
    }
    return blob;
  }

  sessionState(){
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate||!this.lastPayload)return null;
    const storedCandidate=clonePlain(candidate);
    storedCandidate.originalThumbnailUrl=candidate.originalThumbnailUrl||this.cachedReferenceUrl||candidate.thumbnailUrl;
    if(String(storedCandidate.thumbnailUrl||"").startsWith("data:")||String(storedCandidate.thumbnailUrl||"").startsWith("blob:"))storedCandidate.thumbnailUrl=storedCandidate.originalThumbnailUrl;
    return{
      version:2,
      subject:this.lastSubject||this.result?.subject||"",
      lastKey:this.lastKey||"",
      faceRecognitions:clonePlain(this.result?.faceRecognitions||[]),
      guesses:clonePlain(this.result?.guesses||[]),
      model:clonePlain(this.result?.model||null),
      candidate:storedCandidate,
      mappingDraft:clonePlain(this.mappingDraft),
      referenceUrl:storedCandidate.originalThumbnailUrl||"",
      referenceBlob:this.cachedReferenceBlob||null,
    };
  }

  async saveCurrentSession(){
    if(!this.lastPayload)return false;
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate)return false;
    this.sessionSavePromise=this.sessionSavePromise.catch(()=>{}).then(async()=>{
      await this.ensureReferenceBlob(candidate);
      const state=this.sessionState();
      return state?saveReferenceSession(this.lastPayload,state):false;
    });
    return this.sessionSavePromise;
  }

  async persistSelected(){
    await super.persistSelected();
    await this.saveCurrentSession();
  }

  async matchCandidate(index){
    this.mappingDraft=null;
    const candidate=await super.matchCandidate(index);
    if(candidate?.usable){
      candidate.originalThumbnailUrl??=candidate.thumbnailUrl;
      await this.ensureReferenceBlob(candidate);
      await this.saveCurrentSession();
    }
    return candidate;
  }

  async analyse(payload,subject=""){
    const changedSubject=String(subject||"").trim()!==String(this.lastSubject||"").trim();
    if(changedSubject)this.mappingDraft=null;
    return super.analyse(payload,subject);
  }

  async restoreSession(payload){
    if(!payload?.rgb_b64)return false;
    const session=await loadReferenceSession(payload);
    if(!session?.candidate||Number(session.size)!==Number(payload.size))return false;
    const candidate=clonePlain(session.candidate);
    this.cachedReferenceBlob=session.referenceBlob||null;
    this.cachedReferenceUrl=session.referenceUrl||candidate.originalThumbnailUrl||candidate.thumbnailUrl||"";
    candidate.originalThumbnailUrl=this.cachedReferenceUrl||candidate.originalThumbnailUrl||candidate.thumbnailUrl;
    if(this.cachedReferenceBlob){
      const localUrl=await blobToDataUrl(this.cachedReferenceBlob).catch(()=>null);
      if(localUrl)candidate.thumbnailUrl=localUrl;
    }
    this.lastPayload={...payload};
    this.lastSubject=String(session.subject||"");
    this.lastKey=String(session.lastKey||`restored:${session.key||""}`);
    this.mappingDraft=clonePlain(session.mappingDraft);
    this.result={
      subject:this.lastSubject,
      faceRecognitions:clonePlain(session.faceRecognitions||[]),
      guesses:clonePlain(session.guesses||[]),
      model:clonePlain(session.model||null),
      candidates:[candidate],
      selectedIndex:0,
      restored:true,
    };
    this.searchResult=this.result;
    this.selectedIndex=0;
    this.matchingIndex=-1;
    this.panel.hidden=false;
    this.render();
    await super.persistSelected();
    this.statusEl.textContent="Restored saved reference image and cube-wrap mapping";
    return true;
  }

  invalidate(){
    this.aligner?.close?.();
    this.mappingDraft=null;
    super.invalidate();
  }

  async openAlignment(face=null){
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate||!this.lastPayload)return;
    try{
      await this.aligner.open({
        candidate,
        payload:this.lastPayload,
        draft:this.mappingDraft,
        initialMode:face?"face":"global",
        initialFace:face||undefined,
      });
    }catch(error){
      console.warn("Could not open reference alignment",error);
      this.statusEl.textContent=error instanceof Error?error.message:String(error);
    }
  }

  renderAlignmentControls(){
    super.renderAlignmentControls();
    const note=this.sixWrap?.querySelector("[data-ref-align-note]");
    if(note&&!this.sixWrap.hidden){
      const prefix=this.mappingDraft?"Autosaved mapping restored/active. ":"Autosave is on. ";
      note.textContent=prefix+note.textContent;
    }
  }
}
