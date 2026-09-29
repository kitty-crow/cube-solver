import { StickerIdentificationModal as RecommendationStickerIdentificationModal } from "./sticker-identification-ui-v4.js";
import { additionalConflictRelaxations, compatibleReferenceTargets, describeOverrideRemoval, prepareAuthoritativeOverride } from "./sticker-authoritative-override.js";
import { labelForFacelet } from "./sticker-constraints-v2.js";

const clone=value=>value==null?value:structuredClone(value);
const geometryQuarterFromUi=rotation=>((4-(((Number(rotation)||0)%4+4)%4))%4);

function panForFacelet(target){
  const face=Math.floor(Number(target)/9),local=Number(target)%9,row=Math.floor(local/3),col=local%3;
  return{face,u:-1+(col+.5)*2/3,v:1-(row+.5)*2/3};
}

function installV5Styles(){
  if(document.querySelector("#sticker-identification-v5-styles"))return;
  const style=document.createElement("style");
  style.id="sticker-identification-v5-styles";
  style.textContent=`
    .sticker-id__override { display:grid; gap:.55rem; padding:.7rem; border:1px solid var(--app-border); border-radius:.8rem; background:color-mix(in srgb,var(--pages-accent) 5%,transparent); }
    .sticker-id__override-title { margin:0; font-size:.76rem; font-weight:850; }
    .sticker-id__override-row { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr); gap:.5rem; }
    .sticker-id__override-field { display:grid; gap:.24rem; min-width:0; font-size:.66rem; font-weight:750; opacity:.9; }
    .sticker-id__override-field select { width:100%; min-width:0; border:1px solid var(--app-border); border-radius:.55rem; background:var(--pages-bg,#fff); color:inherit; padding:.52rem .58rem; font:inherit; }
    .sticker-id__override-note { margin:0; font-size:.66rem; opacity:.72; line-height:1.35; }
    .sticker-id__override .pages-button { width:100%; }
    @media(max-width:430px){ .sticker-id__override-row { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);
}

export class StickerIdentificationModal extends RecommendationStickerIdentificationModal{
  constructor(options={}){
    super(options);
    installV5Styles();

    this.overrideEl=document.createElement("section");
    this.overrideEl.className="sticker-id__override";
    this.overrideTitle=document.createElement("p");
    this.overrideTitle.className="sticker-id__override-title";
    this.overrideTitle.textContent="100% manual override";

    const row=document.createElement("div");
    row.className="sticker-id__override-row";
    const targetField=document.createElement("label");
    targetField.className="sticker-id__override-field";
    targetField.append(document.createTextNode("Reference segment"));
    this.overrideTarget=document.createElement("select");
    this.overrideTarget.addEventListener("change",()=>this.applyOverridePreview());
    targetField.append(this.overrideTarget);

    const rotationField=document.createElement("label");
    rotationField.className="sticker-id__override-field";
    rotationField.append(document.createTextNode("Quarter-turn"));
    this.overrideRotation=document.createElement("select");
    for(const value of[0,1,2,3]){
      const option=document.createElement("option");option.value=String(value);option.textContent=`${value*90}°`;this.overrideRotation.appendChild(option);
    }
    this.overrideRotation.addEventListener("change",()=>this.applyOverridePreview());
    rotationField.append(this.overrideRotation);
    row.append(targetField,rotationField);

    this.overrideButton=document.createElement("button");
    this.overrideButton.type="button";
    this.overrideButton.className="pages-button pages-button--primary";
    this.overrideButton.textContent="Assign this as 100% certain";
    this.overrideButton.addEventListener("click",()=>this.applyAuthoritativeOverride());

    this.overrideNote=document.createElement("p");
    this.overrideNote.className="sticker-id__override-note";
    this.overrideNote.textContent="This bypasses engine suggestions. If another photographed sticker or cubie currently owns that reference cubie, the conflicting assignment is unassigned automatically.";
    this.overrideEl.append(this.overrideTitle,row,this.overrideButton,this.overrideNote);
    this.recommendationNote?.insertAdjacentElement("afterend",this.overrideEl);
  }

  renderOverrideControls(){
    const sticker=this.analysis?.stickers?.[this.currentTile]||null;
    this.overrideEl.hidden=!sticker||Boolean(this.analysis?.resolved);
    if(!sticker)return;
    this.overrideTitle.textContent=`100% manual override · Photo ${sticker.label} = Reference…`;
    const targets=compatibleReferenceTargets(this.currentTile),current=Number(this.currentTarget());
    const previous=this.overrideTarget.value;
    this.overrideTarget.textContent="";
    for(const target of targets){
      const option=document.createElement("option");option.value=String(target);option.textContent=labelForFacelet(target);this.overrideTarget.appendChild(option);
    }
    const selected=targets.includes(current)?current:(targets.includes(Number(previous))?Number(previous):targets[0]);
    if(Number.isInteger(selected))this.overrideTarget.value=String(selected);
    this.overrideRotation.value=String(((Number(this.quarterTurn)||0)%4+4)%4);
    this.overrideButton.disabled=!targets.length;
  }

  applyOverridePreview(){
    const target=Number(this.overrideTarget.value),rotation=Number(this.overrideRotation.value);
    if(!Number.isInteger(target))return;
    this.pan=panForFacelet(target);
    this.quarterTurn=((rotation%4)+4)%4;
    this.render();
    this.queueSave();
    this.messageEl.textContent=`Manual target selected: ${labelForFacelet(this.currentTile)} → ${labelForFacelet(target)} at ${this.quarterTurn*90}°. Use the 100% override button to make it authoritative.`;
  }

  async analyseOverrideCandidate(confirmations,ambiguities){
    const result=await this.analyse(confirmations,ambiguities).catch(error=>({ok:false,conflict:error.message}));
    return result?.ok&&result.legalStateCount?result:null;
  }

  async applyAuthoritativeOverride(){
    if(this.currentTile==null||this.analysis?.resolved)return;
    const target=Number(this.overrideTarget.value),uiRotation=Number(this.overrideRotation.value),rotation=geometryQuarterFromUi(uiRotation);
    const sourceLabel=labelForFacelet(this.currentTile),targetLabel=labelForFacelet(target);

    // First prove that the requested photo→reference pair and quarter-turn can
    // exist mechanically at all, without allowing stale answers to veto it.
    this.overrideButton.disabled=true;
    this.messageEl.textContent=`Checking authoritative override ${sourceLabel} → ${targetLabel}…`;
    const isolated=await this.analyseOverrideCandidate({[this.currentTile]:{target,rotation}},{});
    if(!isolated){
      this.overrideButton.disabled=false;
      this.messageEl.textContent=`${sourceLabel} → ${targetLabel} at ${uiRotation*90}° cannot occur for that physical ${compatibleReferenceTargets(this.currentTile).includes(target)?"cubie orientation":"sticker type"}. The segment may still be correct, so try another 90° rotation.`;
      return;
    }

    const prepared=prepareAuthoritativeOverride({
      confirmations:this.analysis.confirmations||{},
      ambiguities:this.analysis.ambiguities||{},
      tile:this.currentTile,target,rotation,
    });
    if(!prepared.ok){
      this.overrideButton.disabled=false;
      this.messageEl.textContent=prepared.message||"Could not prepare the authoritative override.";
      return;
    }

    let accepted=prepared,next=await this.analyseOverrideCandidate(prepared.confirmations,prepared.ambiguities);
    if(!next){
      // The direct occupancy collision may not be the whole story. For
      // example, parity can make one other fully confirmed cubie incompatible.
      // Release the smallest additional conflicting cubie that restores at
      // least one legal state, rather than refusing a 100% human assertion.
      for(const variant of additionalConflictRelaxations(prepared)){
        const candidate=await this.analyseOverrideCandidate(variant.confirmations,variant.ambiguities);
        if(candidate){accepted=variant;next=candidate;break;}
      }
    }
    if(!next){
      this.overrideButton.disabled=false;
      this.messageEl.textContent=`The requested ${sourceLabel} → ${targetLabel} mapping is individually possible, but the remaining hard confirmations still make the cube impossible. Unassign another conflicting cubie and retry.`;
      return;
    }

    const oldTile=this.currentTile;
    this.analysis=next;
    this.state.confirmations=clone(next.confirmations);
    this.state.ambiguities=clone(next.ambiguities);
    this.state.resolved=clone(next.resolved||null);
    const removed=(accepted.removed||[]).filter(item=>Number(item.tile)!==Number(oldTile));
    const removedText=removed.length?` Unassigned ${removed.map(describeOverrideRemoval).join(", ")} because ${removed.length===1?"it conflicted":"they conflicted"} with that authoritative mapping.`:"";
    this.onStatus(`${next.confirmedCount} confirmed · ${next.ambiguousCount||0} ambiguous · ${Math.round((next.stateConfidence||0)*100)}% best-state confidence`);

    if(next.resolved){
      this.currentTile=null;this.state.currentTile=null;this.flushState();await Promise.resolve(this.onResolved(this.serialise()));this.render();
      this.messageEl.textContent=`Authoritative override accepted: ${sourceLabel} → ${targetLabel} at ${uiRotation*90}°.${removedText}`;
      return;
    }
    this.currentTile=next.nextTile;this.state.currentTile=this.currentTile;this.setInitialPan(false);this.flushState();this.render();
    this.messageEl.textContent=`Authoritative override accepted: ${sourceLabel} → ${targetLabel} at ${uiRotation*90}°.${removedText}`;
  }

  render(){
    super.render();
    this.renderOverrideControls();
  }
}
