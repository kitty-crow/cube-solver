import { StickerIdentificationModal as AuthoritativeStickerIdentificationModal } from "./sticker-identification-ui-v7.js";
import { CENTRE_FACELETS, labelForFacelet } from "./sticker-constraints-v3.js";
import { renderCubemapPan } from "./sticker-cubemap-view.js";

const centreSet=new Set(CENTRE_FACELETS);
const uiQuarterFromGeometry=rotation=>((4-(((Number(rotation)||0)%4+4)%4))%4);

function orderedStickerTiles(analysis){
  const stickers=analysis?.stickers||{};
  const out=[];
  for(let tile=0;tile<54;tile++)if(!centreSet.has(tile)&&stickers[tile])out.push(tile);
  return out;
}

function installV8Styles(){
  if(document.querySelector("#sticker-identification-v8-styles"))return;
  const style=document.createElement("style");
  style.id="sticker-identification-v8-styles";
  style.textContent=`
    .sticker-id__panel { position:relative; }
    .sticker-id__head { justify-content:flex-end; min-height:2rem; margin-bottom:-.25rem; }
    .sticker-id__head > div { display:none !important; }
    .sticker-id__head [data-id-close] { width:2rem; min-width:2rem; height:2rem; padding:0; display:grid; place-items:center; border-radius:999px; font-size:1.25rem; line-height:1; }
    .sticker-id__work { display:block; }
    .sticker-id__question { width:100%; }
    .sticker-id__overlay-details { width:100%; display:grid; gap:.55rem; margin:.15rem 0 .1rem; border:1px solid var(--app-border); border-radius:.75rem; padding:.45rem .55rem; }
    .sticker-id__overlay-details > summary { cursor:pointer; font-size:.7rem; font-weight:800; opacity:.78; user-select:none; }
    .sticker-id__overlay-details:not([open]) > .sticker-id__viewer-wrap { display:none; }
    .sticker-id__overlay-details .sticker-id__viewer-wrap { width:100%; margin-top:.35rem; }
    .sticker-id__overlay-details .sticker-id__viewer { width:min(100%,24rem); }
    .sticker-id__assignment-actions { display:flex !important; gap:.35rem !important; align-items:stretch !important; flex-wrap:nowrap !important; padding:.3rem; border:1px solid var(--app-border); border-radius:.72rem; background:color-mix(in srgb,var(--pages-accent) 4%,transparent); container-type:inline-size; }
    .sticker-id__assignment-actions > .pages-button { flex:1 1 0 !important; width:0 !important; min-width:0 !important; max-width:none !important; padding-inline:.36rem !important; white-space:nowrap; overflow:visible; text-align:center; justify-content:center; line-height:1.1; }
    .sticker-id__recommendation-list { flex-wrap:nowrap; }
    .sticker-id__override { margin-top:.55rem; }
    .sticker-id__resolution-footer { margin:.35rem .1rem 0; font-size:.64rem; line-height:1.35; opacity:.66; text-align:center; }
    .sticker-id__resolution-footer[hidden] { display:none; }
    .sticker-id__resolved { display:none !important; }
    @media(max-width:520px){
      .sticker-id__assignment-actions { gap:.22rem !important; padding:.24rem; }
      .sticker-id__assignment-actions > .pages-button { padding-inline:.2rem !important; }
    }
  `;
  document.head.appendChild(style);
}

export class StickerIdentificationModal extends AuthoritativeStickerIdentificationModal{
  constructor(options={}){
    super(options);
    installV8Styles();

    const panel=this.root.querySelector(".sticker-id__panel");
    if(panel){panel.removeAttribute("aria-labelledby");panel.setAttribute("aria-label","Sticker assignment");}
    const close=this.root.querySelector("[data-id-close]");
    if(close){close.textContent="×";close.setAttribute("aria-label","Close sticker identification");close.title="Close";}

    // Side-by-side photo/reference is the primary comparison. The larger
    // panning overlay is secondary and starts collapsed directly beneath it.
    this.overlayDetails=document.createElement("details");
    this.overlayDetails.className="sticker-id__overlay-details";
    this.overlaySummary=document.createElement("summary");
    this.overlaySummary.textContent="Overlay preview · 0% reference";
    this.overlayDetails.appendChild(this.overlaySummary);
    if(this.comparisonEl&&this.viewer?.parentElement){
      const viewerWrap=this.viewer.parentElement;
      this.overlayDetails.appendChild(viewerWrap);
      this.comparisonEl.insertAdjacentElement("afterend",this.overlayDetails);
    }
    this.overlayOpacity=0;

    // The manual override belongs after the mapping pills, where it acts as an
    // explicit escape hatch rather than competing with the normal workflow.
    if(this.overrideEl&&this.gridEl)this.gridEl.insertAdjacentElement("afterend",this.overrideEl);

    this.resolutionFooter=document.createElement("p");
    this.resolutionFooter.className="sticker-id__resolution-footer";
    this.resolutionFooter.hidden=true;
    (this.overrideEl||this.gridEl)?.insertAdjacentElement("afterend",this.resolutionFooter);

    // One compact, equal-width action pad. Keep Unassign visible so the layout
    // never jumps; disable it when the selected sticker has no human answer.
    this.assignmentActions=this.confirmButton?.parentElement||null;
    if(this.assignmentActions){
      this.assignmentActions.classList.add("sticker-id__assignment-actions");
      this.assignmentActions.replaceChildren(this.confirmButton,this.unassignButton,this.ambiguousButton,this.nextButton);
    }

    // All legal suggestions are already horizontally scrollable. An extra
    // "More suggestions" state added friction without revealing anything the
    // user could not simply scroll to.
    this.moreSuggestionsButton?.remove();
    this.recommendationLimit=Number.POSITIVE_INFINITY;
  }

  orderedTiles(){return orderedStickerTiles(this.analysis);}

  nextSequentialTile(fromTile=this.currentTile){
    const order=this.orderedTiles(),index=order.indexOf(Number(fromTile));
    if(index<0)return order[0]??null;
    return order[index+1]??null;
  }

  goToSequentialNext(fromTile){
    const next=this.nextSequentialTile(fromTile);
    if(next==null)return false;
    this.currentTile=next;
    this.state.currentTile=next;
    this.setInitialPan(false);
    this.flushState();
    this.render();
    return true;
  }

  async open(options={}){
    await super.open(options);
    const wanted=Number(options.state?.currentTile);
    const hasSaved=Number.isInteger(wanted)&&this.analysis?.stickers?.[wanted];
    if(!hasSaved){
      const first=this.orderedTiles()[0]??null;
      if(first!=null){this.currentTile=first;this.state.currentTile=first;this.setInitialPan(false);}
    }
    this.overlayOpacity=0;
    if(this.overlayDetails)this.overlayDetails.open=false;
    this.render();
    this.queueSave();
  }

  renderSuggestions(sticker){
    this.suggestionsEl.textContent="";
    this.suggestionsEl.classList.add("sticker-id__recommendation-list");
    const options=this.recommendationOptions(sticker),best=options[0]||null;
    const currentTarget=Number(this.currentTarget()),currentRotation=Number(this.quarterTurn);
    for(let index=0;index<options.length;index++){
      const option=options[index],uiRotation=uiQuarterFromGeometry(option.rotation),button=document.createElement("button");
      const selected=currentTarget===Number(option.target)&&currentRotation===uiRotation;
      button.type="button";
      button.className="pages-button pages-button--quiet";
      button.dataset.engineBest=String(index===0);
      button.dataset.selected=String(selected);
      button.setAttribute("aria-pressed",String(selected));
      const score=Number(option.score),bestPrefix=index===0?"★ ":"";
      button.textContent=`${bestPrefix}${index+1}. ${labelForFacelet(option.target)} · ${uiRotation*90}°${Number.isFinite(score)?` · ${Math.round(score*100)}%`:""}`;
      button.title=index===0?"Engine's current best legal suggestion":"Alternative legal segment suggested by the engine";
      button.addEventListener("click",()=>this.applySuggestion(option));
      this.suggestionsEl.appendChild(button);
    }
    if(!options.length){
      const empty=document.createElement("span");empty.className="sticker-id__note";empty.textContent="No unclaimed alternative segments remain for this sticker.";this.suggestionsEl.appendChild(empty);
    }
    this.resetSuggestionButton.disabled=!best;
  }

  renderViewer(){
    const photo=this.referenceCanvas,photoCtx=photo.getContext("2d",{alpha:false});
    photoCtx.fillStyle="#111";photoCtx.fillRect(0,0,photo.width,photo.height);
    if(this.scanTiles?.[this.currentTile])photoCtx.drawImage(this.scanTiles[this.currentTile],0,0,photo.width,photo.height);

    const reference=this.overlayCanvas;
    if(this.facePixels&&this.pan)renderCubemapPan(reference,this.facePixels,this.pan,this.quarterTurn);
    else{const ctx=reference.getContext("2d",{alpha:false});ctx.fillStyle="#111";ctx.fillRect(0,0,reference.width,reference.height);}
    reference.style.opacity=String(this.overlayOpacity);
    reference.style.transition="opacity 120ms linear";
    const pct=Math.round(this.overlayOpacity*100);
    if(this.overlayButton)this.overlayButton.textContent=`Overlay ${pct}%`;
    if(this.overlaySummary)this.overlaySummary.textContent=`Overlay preview · ${pct}% reference`;
  }

  cycleOverlay(){
    const values=[0,.25,.5,.75,1],current=Number(this.overlayOpacity)||0;
    let index=values.findIndex(value=>Math.abs(value-current)<.001);
    if(index<0)index=0;
    this.overlayOpacity=values[(index+1)%values.length];
    this.renderViewer();
  }

  fitAssignmentButtons(){
    if(!this.assignmentActions)return;
    const buttons=[this.confirmButton,this.unassignButton,this.ambiguousButton,this.nextButton].filter(Boolean);
    for(const button of buttons)button.style.fontSize="12.5px";
    let size=12.5;
    while(size>8&&buttons.some(button=>button.scrollWidth>button.clientWidth+1)){
      size-=.5;
      for(const button of buttons)button.style.fontSize=`${size}px`;
    }
  }

  render(){
    super.render();
    if(this.resolvedEl)this.resolvedEl.hidden=true;
    if(this.moreSuggestionsButton)this.moreSuggestionsButton.hidden=true;

    const sticker=this.analysis?.stickers?.[this.currentTile]||null;
    if(this.confirmButton)this.confirmButton.textContent="Assign";
    if(this.ambiguousButton)this.ambiguousButton.textContent="Ambiguous · 50%";
    if(this.nextButton){this.nextButton.textContent="Not sure · next";this.nextButton.disabled=this.nextSequentialTile()==null;}
    if(this.unassignButton){
      this.unassignButton.hidden=false;
      this.unassignButton.textContent="Unassign";
      this.unassignButton.disabled=!Boolean(sticker?.confirmed||sticker?.ambiguous);
    }

    const resolved=this.analysis?.resolved||null;
    if(this.resolutionFooter){
      this.resolutionFooter.hidden=!resolved;
      if(resolved){
        const confidence=Math.round(Number(resolved.confidence??this.analysis?.stateConfidence??1)*100);
        this.resolutionFooter.textContent=resolved.exact
          ?"Unique legal scramble found. You can still review, unassign or override any sticker before solving."
          :`High-confidence legal scramble ready (${confidence}%). Ambiguous answers remain soft and can be replaced by stronger assignments or mechanical inference.`;
      }
    }

    this.renderViewer();
    requestAnimationFrame(()=>this.fitAssignmentButtons());
  }

  nextQuestion(){
    const from=this.currentTile;
    if(!this.goToSequentialNext(from)&&from!=null)this.messageEl.textContent="This is the last sticker in face order.";
  }

  async confirmCurrent(){
    const from=Number(this.currentTile),target=Number(this.currentTarget()),quarter=Number(this.quarterTurn);
    await super.confirmCurrent();
    const after=this.analysis?.confirmations?.[from];
    const accepted=after&&Number(after.target)===target&&uiQuarterFromGeometry(after.rotation)===quarter;
    if(accepted)this.goToSequentialNext(from);
  }

  async markAmbiguous(){
    const from=Number(this.currentTile),target=Number(this.currentTarget()),quarter=Number(this.quarterTurn);
    await super.markAmbiguous();
    const after=this.analysis?.ambiguities?.[from];
    const accepted=after&&Number(after.target)===target&&uiQuarterFromGeometry(after.rotation)===quarter;
    if(accepted)this.goToSequentialNext(from);
  }

  async applyAuthoritativeOverride(){
    const from=Number(this.currentTile),target=Number(this.overrideTarget?.value),rotation=Number(this.overrideRotation?.value);
    await super.applyAuthoritativeOverride();
    const after=this.analysis?.confirmations?.[from];
    const accepted=after&&Number(after.target)===target&&uiQuarterFromGeometry(after.rotation)===rotation;
    if(accepted)this.goToSequentialNext(from);
  }

  async unassignCurrent(){
    // Unassign deliberately stays on the same pill so the user can immediately
    // see whether the mapping disappeared or was re-inferred mechanically.
    return super.unassignCurrent();
  }
}
