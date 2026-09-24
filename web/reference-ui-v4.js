import { ReferenceAssistant as BaseReferenceAssistant } from "./reference-ui-v3.js";
import { ReferenceAlignmentModal } from "./reference-aligner-v3.js";

function installLaunchStyles(){
  if(document.querySelector("#reference-aligner-launch-styles"))return;
  const style=document.createElement("style");
  style.id="reference-aligner-launch-styles";
  style.textContent=`
    .reference-aligner-launch { display:flex; flex-wrap:wrap; gap:.45rem; align-items:center; }
    .reference-aligner-launch__note { margin:0; font-size:.68rem; opacity:.72; }
  `;
  document.head.appendChild(style);
}

export class ReferenceAssistant extends BaseReferenceAssistant{
  constructor(options={}){
    super(options);
    installLaunchStyles();
    this.aligner=new ReferenceAlignmentModal({
      onStatus:(message)=>{if(message)this.statusEl.textContent=message;},
      onCommit:async(candidate)=>{
        if(!this.result||this.selectedIndex<0)return;
        this.result.candidates[this.selectedIndex]=candidate;
        this.render();
        await this.persistSelected();
        window.dispatchEvent(new CustomEvent("picture-reference-ready"));
      },
    });
  }

  invalidate(){
    this.aligner?.close?.();
    super.invalidate();
  }

  selectedEvidence(){
    const evidence=super.selectedEvidence();
    if(!evidence)return null;
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(candidate?.projection?.manual){
      evidence.reference={
        ...(evidence.reference||{}),
        manual_alignment:true,
        projection_kind:candidate.projection.kind,
        orientation:{
          yaw:Number(candidate.projection.orientation?.yaw||0),
          pitch:Number(candidate.projection.orientation?.pitch||0),
          roll:Number(candidate.projection.orientation?.roll||0),
        },
        face_warps:candidate.projection.faceWarps||null,
        alignment_diagnostics:candidate.manualDiagnostics||null,
      };
    }
    return evidence;
  }

  render(){
    super.render();
    this.renderAlignmentControls();
  }

  renderAlignmentControls(){
    if(!this.sixWrap)return;
    let tools=this.sixWrap.querySelector("[data-ref-align-tools]");
    if(!tools){
      tools=document.createElement("div");
      tools.className="reference-aligner-launch";
      tools.dataset.refAlignTools="";
      const button=document.createElement("button");
      button.type="button";
      button.className="pages-button";
      button.dataset.refAlignOpen="";
      button.addEventListener("click",()=>this.openAlignment());
      const note=document.createElement("p");
      note.className="reference-aligner-launch__note";
      note.dataset.refAlignNote="";
      tools.append(button,note);
      const title=this.sixWrap.querySelector(".reference-six__title");
      title?.insertAdjacentElement("afterend",tools);
      if(!title)this.sixWrap.insertAdjacentElement("afterbegin",tools);
    }

    const candidate=this.result?.candidates?.[this.selectedIndex];
    const button=tools.querySelector("[data-ref-align-open]");
    const note=tools.querySelector("[data-ref-align-note]");
    const editable=Boolean(candidate?.usable&&candidate?.projection?.editable&&candidate.projection.kind==="equirectangular"&&this.lastPayload);
    tools.hidden=!editable;
    if(!editable)return;
    button.textContent=candidate.projection.manual?"Refine artwork mapping":"Adjust artwork mapping";
    const d=candidate.manualDiagnostics;
    if(d){
      note.textContent=`Manual correction ${Number(d.angularErrorDeg||0).toFixed(1)}° · centre margin ${(Number(d.corrected?.centreMargin||0)*100).toFixed(1)}% (auto ${(Number(d.automatic?.centreMargin||0)*100).toFixed(1)}%)`;
    }else{
      note.textContent="The photographed cube stays fixed while you drag, rotate, scale and warp the internet artwork overlay into place.";
    }
  }

  async openAlignment(){
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate||!this.lastPayload)return;
    try{
      await this.aligner.open({candidate,payload:this.lastPayload});
    }catch(error){
      console.warn("Could not open reference alignment",error);
      this.statusEl.textContent=error instanceof Error?error.message:String(error);
    }
  }
}
