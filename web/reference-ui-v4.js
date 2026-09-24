import { ReferenceAssistant as BaseReferenceAssistant } from "./reference-ui-v3.js";
import { ReferenceAlignmentModal } from "./reference-aligner-v5.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const DISPLAY_FACE_ORDER=["F","R","B","L","U","D"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};

function installLaunchStyles(){
  if(document.querySelector("#reference-aligner-launch-styles"))return;
  const style=document.createElement("style");
  style.id="reference-aligner-launch-styles";
  style.textContent=`
    .reference-aligner-launch { display:flex; flex-wrap:wrap; gap:.45rem; align-items:center; }
    .reference-aligner-launch__note { margin:0; font-size:.68rem; opacity:.72; }
    .reference-six__face--editable { cursor:pointer; }
    .reference-six__face--editable:focus-visible { outline:2px solid var(--pages-accent); outline-offset:2px; }
    .reference-six__face--locked { box-shadow:inset 0 0 0 2px color-mix(in srgb,currentColor 62%,transparent); }
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
        face_orientations:candidate.projection.faceOrientations||null,
        face_warps:candidate.projection.faceWarps||null,
        locked_faces:candidate.projection.lockedFaces||null,
        transform_locks:candidate.projection.transformLocks||null,
        alignment_diagnostics:candidate.manualDiagnostics||null,
      };
    }
    return evidence;
  }

  render(){
    super.render();
    this.decorateFacePreviews();
    this.renderAlignmentControls();
  }

  decorateFacePreviews(){
    if(!this.sixGrid)return;
    const candidate=this.result?.candidates?.[this.selectedIndex];
    const editable=Boolean(candidate?.usable&&candidate?.projection?.editable&&candidate.projection.kind==="equirectangular"&&this.lastPayload);
    const locked=candidate?.projection?.lockedFaces||{};
    const figures=[...this.sixGrid.querySelectorAll(".reference-six__face")];
    const byFace=new Map();
    for(const figure of figures){
      const alt=figure.querySelector("img")?.alt||"";
      const face=FACE_NAMES.find(name=>alt.endsWith(` ${name}`))||String(figure.querySelector("figcaption")?.textContent||"").trim();
      if(FACE_NAMES.includes(face))byFace.set(face,figure);
    }
    for(const face of DISPLAY_FACE_ORDER){
      const figure=byFace.get(face);if(!figure)continue;
      this.sixGrid.appendChild(figure);
      const caption=figure.querySelector("figcaption"),isLocked=Boolean(Array.isArray(locked)?locked.includes(face):locked?.[face]);
      figure.dataset.refFace=face;
      figure.classList.toggle("reference-six__face--editable",editable);
      figure.classList.toggle("reference-six__face--locked",isLocked);
      if(caption)caption.textContent=`${FACE_LABELS[face]} · ${face}${isLocked?" · locked":""}`;
      if(!editable){figure.removeAttribute("role");figure.removeAttribute("tabindex");figure.removeAttribute("aria-label");figure.onclick=null;figure.onkeydown=null;continue;}
      figure.setAttribute("role","button");
      figure.tabIndex=0;
      figure.setAttribute("aria-label",isLocked?`${FACE_LABELS[face]} face is locked. Open face controls to unlock it.`:`Edit ${FACE_LABELS[face]} face mapping`);
      figure.onclick=()=>this.openAlignment(face);
      figure.onkeydown=(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();this.openAlignment(face);}};
    }
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
    button.textContent="Global refine";
    const lockedCount=FACE_NAMES.filter(face=>Boolean(Array.isArray(candidate.projection.lockedFaces)?candidate.projection.lockedFaces.includes(face):candidate.projection.lockedFaces?.[face])).length;
    const d=candidate.manualDiagnostics;
    if(d){
      note.textContent=`Manual correction ${Number(d.angularErrorDeg||0).toFixed(1)}° · centre margin ${(Number(d.corrected?.centreMargin||0)*100).toFixed(1)}% (auto ${(Number(d.automatic?.centreMargin||0)*100).toFixed(1)}%) · ${lockedCount} face${lockedCount===1?"":"s"} locked. Tap a face below for per-face wrap.`;
    }else{
      note.textContent="Global refine moves the internet artwork across all unlocked faces. Tap any face below for per-face wrapping; locked faces stay unchanged.";
    }
  }

  async openAlignment(face=null){
    const candidate=this.result?.candidates?.[this.selectedIndex];
    if(!candidate||!this.lastPayload)return;
    try{
      await this.aligner.open({
        candidate,
        payload:this.lastPayload,
        initialMode:face?"face":"global",
        initialFace:face||undefined,
      });
    }catch(error){
      console.warn("Could not open reference alignment",error);
      this.statusEl.textContent=error instanceof Error?error.message:String(error);
    }
  }
}
