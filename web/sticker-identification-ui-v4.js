import { StickerIdentificationModal as ConfidenceStickerIdentificationModal } from "./sticker-identification-ui-v3.js";
import { renderCubemapPan } from "./sticker-cubemap-view.js";
import { labelForFacelet } from "./sticker-constraints-v2.js";

const clone=value=>value==null?value:structuredClone(value);
const uiQuarterFromGeometry=rotation=>((4-(((Number(rotation)||0)%4+4)%4))%4);

function panForFacelet(target){
  const face=Math.floor(Number(target)/9),local=Number(target)%9,row=Math.floor(local/3),col=local%3;
  return{face,u:-1+(col+.5)*2/3,v:1-(row+.5)*2/3};
}

function installV4Styles(){
  if(document.querySelector("#sticker-identification-v4-styles"))return;
  const style=document.createElement("style");
  style.id="sticker-identification-v4-styles";
  style.textContent=`
    .sticker-id__comparison { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.65rem; width:100%; align-items:start; }
    .sticker-id__comparison-item { min-width:0; margin:0; display:grid; gap:.35rem; }
    .sticker-id__comparison-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.7rem; font-weight:800; opacity:.78; text-align:center; }
    .sticker-id__comparison .sticker-id__scan,
    .sticker-id__reference-segment { display:block; width:100%; max-width:none; aspect-ratio:1; border-radius:.75rem; border:1px solid var(--app-border); background:#111; }
    .sticker-id__recommendation-tools { display:flex; gap:.45rem; align-items:center; justify-content:space-between; flex-wrap:wrap; min-width:0; }
    .sticker-id__recommendation-title { font-size:.72rem; font-weight:800; opacity:.82; }
    .sticker-id__recommendation-list { display:flex; gap:.4rem; overflow-x:auto; max-width:100%; min-width:0; padding:.08rem .04rem .28rem; scrollbar-width:thin; }
    .sticker-id__recommendation-list .pages-button { flex:0 0 auto; max-width:min(17rem,78vw); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sticker-id__recommendation-list .pages-button[data-selected="true"] { outline:2px solid color-mix(in srgb,var(--pages-accent) 82%,transparent); outline-offset:1px; background:color-mix(in srgb,var(--pages-accent) 13%,transparent); }
    .sticker-id__recommendation-list .pages-button[data-engine-best="true"][data-selected="false"] { font-weight:800; }
    .sticker-id__recommendation-note { margin:0; font-size:.68rem; opacity:.7; }
    @media(max-width:430px){
      .sticker-id__comparison { gap:.45rem; }
      .sticker-id__comparison-label { font-size:.64rem; }
      .sticker-id__recommendation-tools { align-items:stretch; }
      .sticker-id__recommendation-tools .pages-button { width:100%; }
      .sticker-id__recommendation-list .pages-button { max-width:76vw; }
    }
  `;
  document.head.appendChild(style);
}

export class StickerIdentificationModal extends ConfidenceStickerIdentificationModal{
  constructor(options={}){
    super(options);
    installV4Styles();
    this.recommendationLimit=6;

    this.comparisonEl=document.createElement("div");
    this.comparisonEl.className="sticker-id__comparison";
    const photoFigure=document.createElement("figure");
    photoFigure.className="sticker-id__comparison-item";
    this.photoComparisonLabel=document.createElement("figcaption");
    this.photoComparisonLabel.className="sticker-id__comparison-label";
    this.photoComparisonLabel.textContent="Photographed sticker";
    const referenceFigure=document.createElement("figure");
    referenceFigure.className="sticker-id__comparison-item";
    this.referenceComparisonCanvas=document.createElement("canvas");
    this.referenceComparisonCanvas.className="sticker-id__reference-segment";
    this.referenceComparisonCanvas.width=180;
    this.referenceComparisonCanvas.height=180;
    this.referenceComparisonLabel=document.createElement("figcaption");
    this.referenceComparisonLabel.className="sticker-id__comparison-label";
    this.referenceComparisonLabel.textContent="Selected reference";
    const scanParent=this.scanCanvas?.parentElement;
    if(scanParent&&this.scanCanvas){
      scanParent.insertBefore(this.comparisonEl,this.scanCanvas);
      photoFigure.append(this.scanCanvas,this.photoComparisonLabel);
      referenceFigure.append(this.referenceComparisonCanvas,this.referenceComparisonLabel);
      this.comparisonEl.append(photoFigure,referenceFigure);
    }

    this.recommendationTools=document.createElement("div");
    this.recommendationTools.className="sticker-id__recommendation-tools";
    this.recommendationTitle=document.createElement("span");
    this.recommendationTitle.className="sticker-id__recommendation-title";
    this.recommendationTitle.textContent="Engine recommendations";

    this.resetSuggestionButton=document.createElement("button");
    this.resetSuggestionButton.type="button";
    this.resetSuggestionButton.className="pages-button pages-button--quiet";
    this.resetSuggestionButton.textContent="Reset to engine pick";
    this.resetSuggestionButton.addEventListener("click",()=>this.resetToEngineSuggestion());

    this.moreSuggestionsButton=document.createElement("button");
    this.moreSuggestionsButton.type="button";
    this.moreSuggestionsButton.className="pages-button pages-button--quiet";
    this.moreSuggestionsButton.textContent="More suggestions";
    this.moreSuggestionsButton.addEventListener("click",()=>{
      this.recommendationLimit=this.recommendationLimit===6?48:6;
      this.render();
    });

    const controls=document.createElement("div");
    controls.className="sticker-id__actions";
    controls.append(this.resetSuggestionButton,this.moreSuggestionsButton);
    this.recommendationTools.append(this.recommendationTitle,controls);

    this.recommendationNote=document.createElement("p");
    this.recommendationNote.className="sticker-id__recommendation-note";
    this.recommendationNote.textContent="Suggestions are legal candidates only. Segments already hard-confirmed or mechanically inferred for another sticker are removed.";

    this.suggestionsEl?.insertAdjacentElement("beforebegin",this.recommendationTools);
    this.suggestionsEl?.insertAdjacentElement("afterend",this.recommendationNote);
  }

  occupiedTargets(){
    const occupied=new Set();
    for(const sticker of Object.values(this.analysis?.stickers||{})){
      if(Number(sticker?.tile)===Number(this.currentTile))continue;
      if(sticker?.confirmed?.target!=null){occupied.add(Number(sticker.confirmed.target));continue;}
      if(sticker?.status==="inferred"&&Array.isArray(sticker.domain)&&sticker.domain.length===1){
        occupied.add(Number(sticker.domain[0].target));
      }
    }
    return occupied;
  }

  recommendationOptions(sticker){
    if(!sticker)return[];
    const occupied=this.occupiedTargets(),byTarget=new Map();
    for(const option of sticker.domain||[]){
      const target=Number(option.target);
      if(occupied.has(target))continue;
      const old=byTarget.get(target);
      if(!old||Number(option.score||0)>Number(old.score||0))byTarget.set(target,option);
    }
    return [...byTarget.values()].sort((a,b)=>Number(b.score||0)-Number(a.score||0)||Number(a.target)-Number(b.target));
  }

  engineSuggestion(sticker=this.analysis?.stickers?.[this.currentTile]){
    return this.recommendationOptions(sticker)[0]||sticker?.best||sticker?.domain?.[0]||null;
  }

  applySuggestion(option,{announce=true,reset=false}={}){
    if(!option)return;
    this.pan=panForFacelet(option.target);
    this.quarterTurn=uiQuarterFromGeometry(option.rotation);
    this.render();
    this.queueSave();
    if(announce){
      const prefix=reset?"Reset to engine pick":"Selected suggestion";
      this.messageEl.textContent=`${prefix}: ${labelForFacelet(option.target)} at ${this.quarterTurn*90}°.`;
    }
  }

  resetToEngineSuggestion(){
    this.applySuggestion(this.engineSuggestion(),{announce:true,reset:true});
  }

  renderComparison(){
    if(!this.referenceComparisonCanvas)return;
    const sticker=this.analysis?.stickers?.[this.currentTile]||null;
    const target=Number(this.currentTarget());
    this.photoComparisonLabel.textContent=sticker?`Photo · ${sticker.label}`:"Photographed sticker";
    this.referenceComparisonLabel.textContent=Number.isInteger(target)
      ?`Reference · ${labelForFacelet(target)} · ${Number(this.quarterTurn||0)*90}°`
      :"Selected reference";
    const ctx=this.referenceComparisonCanvas.getContext("2d",{alpha:false});
    if(!this.facePixels||!this.pan){
      ctx.fillStyle="#111";
      ctx.fillRect(0,0,this.referenceComparisonCanvas.width,this.referenceComparisonCanvas.height);
      return;
    }
    renderCubemapPan(this.referenceComparisonCanvas,this.facePixels,this.pan,this.quarterTurn);
  }

  renderViewer(){
    super.renderViewer();
    this.renderComparison();
  }

  renderSuggestions(sticker){
    this.suggestionsEl.textContent="";
    this.suggestionsEl.classList.add("sticker-id__recommendation-list");
    const options=this.recommendationOptions(sticker),limit=Math.min(this.recommendationLimit,options.length),best=options[0]||null;
    const currentTarget=Number(this.currentTarget()),currentRotation=Number(this.quarterTurn);
    for(let index=0;index<limit;index++){
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
      const empty=document.createElement("span");
      empty.className="sticker-id__note";
      empty.textContent="No unclaimed alternative segments remain for this sticker.";
      this.suggestionsEl.appendChild(empty);
    }
    this.moreSuggestionsButton.hidden=options.length<=6;
    this.moreSuggestionsButton.textContent=this.recommendationLimit===6?`More suggestions (${options.length})`:"Show top suggestions";
    this.resetSuggestionButton.disabled=!best;
  }

  render(){
    super.render();
    this.renderComparison();
    const sticker=this.analysis?.stickers?.[this.currentTile]||null,best=this.engineSuggestion(sticker);
    this.recommendationTools.hidden=!sticker;
    this.recommendationNote.hidden=!sticker;
    if(!sticker)return;
    const currentTarget=Number(this.currentTarget()),currentRotation=Number(this.quarterTurn),bestRotation=best?uiQuarterFromGeometry(best.rotation):-1;
    const alreadyAtBest=Boolean(best)&&currentTarget===Number(best.target)&&currentRotation===bestRotation;
    this.resetSuggestionButton.disabled=!best||alreadyAtBest;
    this.resetSuggestionButton.textContent=alreadyAtBest?"At engine pick":"Reset to engine pick";
    this.recommendationTitle.textContent=best?`Engine recommendations · best ${labelForFacelet(best.target)}`:"Engine recommendations";
  }

  async confirmCurrent(){
    await super.confirmCurrent();
    this.recommendationLimit=6;
  }

  async markAmbiguous(){
    await super.markAmbiguous();
    this.recommendationLimit=6;
  }

  async unassignCurrent(){
    await super.unassignCurrent();
    this.recommendationLimit=6;
  }

  selectTile(tile,options={}){
    this.recommendationLimit=6;
    return super.selectTile(tile,options);
  }

  serialise(){
    const base=super.serialise();
    return{...clone(base),recommendationLimit:6};
  }
}
