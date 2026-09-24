import { StickerIdentificationModal as CubemapStickerIdentificationModal } from "./sticker-identification-ui-v2.js";
import { CENTRE_FACELETS, labelForFacelet, isCentreFacelet } from "./sticker-constraints-v2.js";

const centreSet=new Set(CENTRE_FACELETS);
const clone=value=>value==null?value:structuredClone(value);
const geometryQuarterFromUi=rotation=>((4-(((Number(rotation)||0)%4+4)%4))%4);
const uiQuarterFromGeometry=rotation=>((4-(((Number(rotation)||0)%4+4)%4))%4);

function installV3Styles(){
  if(document.querySelector("#sticker-identification-v3-styles"))return;
  const style=document.createElement("style");
  style.id="sticker-identification-v3-styles";
  style.textContent=`
    .sticker-id__cell { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .sticker-id__cell--ambiguous { outline:1px dashed color-mix(in srgb,var(--pages-accent) 78%,transparent); background:color-mix(in srgb,var(--pages-accent) 7%,transparent); }
    .sticker-id__confidence { font-weight:800; }
    @media(max-width:720px){ .sticker-id__grid{grid-template-columns:repeat(6,minmax(0,1fr));} }
    @media(max-width:430px){ .sticker-id__grid{grid-template-columns:repeat(4,minmax(0,1fr));} }
  `;
  document.head.appendChild(style);
}

export class StickerIdentificationModal extends CubemapStickerIdentificationModal{
  constructor(options={}){
    super(options);
    installV3Styles();
    const actions=this.confirmButton?.parentElement;
    this.ambiguousButton=document.createElement("button");
    this.ambiguousButton.type="button";
    this.ambiguousButton.className="pages-button";
    this.ambiguousButton.textContent="Mark ambiguous · 50%";
    this.ambiguousButton.addEventListener("click",()=>this.markAmbiguous());
    actions?.insertBefore(this.ambiguousButton,this.nextButton||null);
  }

  async analyse(confirmations,ambiguities=this.state?.ambiguities||{}){
    const requestId=++this.requestId;
    const input={
      confirmations,
      ambiguities,
      absoluteF32B64:this.candidate?.evidence?.absolute_f32_b64||"",
      centerRotations:this.centerRotations,
    };
    return new Promise((resolve,reject)=>{
      this.pending.set(requestId,{resolve,reject});
      this.worker.postMessage({type:"analyse",requestId,input});
    });
  }

  async open(options={}){
    await super.open(options);
    this.state.ambiguities=this.state.ambiguities||clone(this.analysis?.ambiguities||{});
    this.render();
  }

  serialise(){
    const base=super.serialise();
    return{
      ...base,
      version:2,
      ambiguities:clone(this.analysis?.ambiguities||this.state?.ambiguities||{}),
      summary:this.analysis?{
        confirmedCount:this.analysis.confirmedCount,
        ambiguousCount:this.analysis.ambiguousCount||0,
        inferredCount:this.analysis.inferredCount,
        unresolvedCount:this.analysis.unresolvedCount,
        legalStateCount:this.analysis.legalStateCount,
        stateConfidence:Number(this.analysis.stateConfidence||0),
        resolutionKind:this.analysis.resolutionKind||null,
      }:base.summary,
    };
  }

  setInitialPan(keepSaved=false){
    const sticker=this.analysis?.stickers?.[this.currentTile];
    if(keepSaved&&this.state?.pan&&Number(this.state.currentTile)===Number(this.currentTile)){
      this.pan=clone(this.state.pan);
      this.quarterTurn=((Number(this.state.quarterTurn)||0)%4+4)%4;
      return;
    }
    const option=sticker?.confirmed||sticker?.ambiguous||sticker?.best||sticker?.domain?.[0];
    const target=Number(option?.target??0),face=Math.floor(target/9),local=target%9,row=Math.floor(local/3),col=local%3;
    this.pan={face,u:-1+(col+.5)*2/3,v:1-(row+.5)*2/3};
    this.quarterTurn=uiQuarterFromGeometry(option?.rotation||0);
  }

  render(){
    super.render();
    if(!this.analysis)return;
    const countText=this.analysis.legalStateCountCapped?`${this.analysis.legalStateCount.toLocaleString()}+`:this.analysis.legalStateCount.toLocaleString();
    const confidence=Math.round(Number(this.analysis.stateConfidence||0)*100);
    this.statsEl.innerHTML=`<span class="sticker-id__stat">${this.analysis.confirmedCount} confirmed</span><span class="sticker-id__stat">${this.analysis.ambiguousCount||0} ambiguous</span><span class="sticker-id__stat">${this.analysis.inferredCount} inferred</span><span class="sticker-id__stat">${this.analysis.unresolvedCount} unresolved</span><span class="sticker-id__stat">${countText} legal state${this.analysis.legalStateCount===1?"":"s"}</span><span class="sticker-id__stat sticker-id__confidence">best state ${confidence}%</span>`;
    if(this.analysis.resolved){
      this.resolvedEl.hidden=false;
      this.resolvedEl.textContent=this.analysis.resolutionKind==="unique"
        ?`Unique legal scramble found. ${this.analysis.confirmedCount} hard confirmation${this.analysis.confirmedCount===1?"":"s"} were enough; the rest is mechanically forced.`
        :`High-confidence legal scramble found (${confidence}%). Hard confirmations remain absolute; ambiguous answers count as 50% hints and unresolved pieces are selected using cube mechanics plus image evidence.`;
    }
    const sticker=this.analysis.stickers?.[this.currentTile];
    if(!sticker){this.ambiguousButton.hidden=true;return;}
    const target=this.currentTarget(),allowed=this.allowedForCurrentTarget(),pairAllowed=allowed.includes(this.quarterTurn),canHint=!this.analysis.resolved&&!sticker.confirmed&&!isCentreFacelet(target)&&pairAllowed;
    this.ambiguousButton.hidden=false;
    this.ambiguousButton.disabled=!canHint;
    this.ambiguousButton.textContent=sticker.ambiguous?"Update ambiguous · 50%":"Mark ambiguous · 50%";
    this.unassignButton.hidden=!(sticker.confirmed||sticker.ambiguous);
    if(sticker.ambiguous&&!sticker.confirmed){
      this.messageEl.textContent=`Soft hint: ${labelForFacelet(sticker.ambiguous.target)} at ${uiQuarterFromGeometry(sticker.ambiguous.rotation)*90}° is weighted at 50%. It can be overridden by exact cube constraints or stronger evidence.`;
    }
  }

  renderGrid(){
    this.gridEl.textContent="";
    for(let tile=0;tile<54;tile++){
      if(centreSet.has(tile))continue;
      const sticker=this.analysis?.stickers?.[tile];if(!sticker)continue;
      const button=document.createElement("button");
      button.type="button";
      button.className=`sticker-id__cell sticker-id__cell--${sticker.status}${tile===this.currentTile?" sticker-id__cell--active":""}`;
      const inferred=sticker.status==="inferred"&&sticker.domain.length===1?sticker.domain[0]:null;
      const value=sticker.confirmed||sticker.ambiguous||inferred;
      const prefix=sticker.ambiguous&&!sticker.confirmed?"~":"";
      button.textContent=value?`${prefix}${sticker.label}→${labelForFacelet(value.target)}`:sticker.label;
      button.title=value?`${sticker.label} ${sticker.ambiguous&&!sticker.confirmed?"softly suggests":"maps to"} ${labelForFacelet(value.target)} at ${uiQuarterFromGeometry(value.rotation)*90}°`: `${sticker.label}: ${sticker.domain.length} legal options`;
      button.addEventListener("click",()=>this.selectTile(tile));
      this.gridEl.appendChild(button);
    }
  }

  async confirmCurrent(){
    const target=this.currentTarget(),allowed=this.allowedForCurrentTarget();
    if(!allowed.includes(this.quarterTurn)||isCentreFacelet(target))return;
    const tentative={...(this.analysis.confirmations||{}),[this.currentTile]:{target,rotation:geometryQuarterFromUi(this.quarterTurn)}};
    const ambiguities={...(this.analysis.ambiguities||{})};delete ambiguities[this.currentTile];
    const previous=this.analysis;this.messageEl.textContent="Checking cube legality…";this.confirmButton.disabled=true;
    const next=await this.analyse(tentative,ambiguities).catch(error=>({ok:false,conflict:error.message}));
    if(!next.ok||!next.legalStateCount){this.analysis=previous;this.messageEl.textContent=next.conflict||"That assignment conflicts with the remaining legal cube states.";this.render();return;}
    this.analysis=next;this.state.confirmations=clone(next.confirmations);this.state.ambiguities=clone(next.ambiguities);this.state.resolved=clone(next.resolved||null);
    this.onStatus(`${next.confirmedCount} confirmed · ${next.ambiguousCount||0} ambiguous · ${Math.round((next.stateConfidence||0)*100)}% best-state confidence`);
    if(next.resolved){this.currentTile=null;this.state.currentTile=null;this.flushState();await Promise.resolve(this.onResolved(this.serialise()));this.render();return;}
    this.currentTile=next.nextTile;this.state.currentTile=this.currentTile;this.setInitialPan(false);this.flushState();this.render();
  }

  async markAmbiguous(){
    const target=this.currentTarget(),allowed=this.allowedForCurrentTarget();
    if(!allowed.includes(this.quarterTurn)||isCentreFacelet(target)||this.analysis?.resolved)return;
    const confirmations={...(this.analysis.confirmations||{})};delete confirmations[this.currentTile];
    const ambiguities={...(this.analysis.ambiguities||{}),[this.currentTile]:{target,rotation:geometryQuarterFromUi(this.quarterTurn),weight:.5}};
    this.messageEl.textContent="Adding a 50% human hint and propagating cubie constraints…";
    const next=await this.analyse(confirmations,ambiguities).catch(error=>({ok:false,conflict:error.message}));
    if(!next.ok){this.messageEl.textContent=next.conflict||"Could not apply ambiguous hint.";return;}
    this.analysis=next;this.state.confirmations=clone(next.confirmations);this.state.ambiguities=clone(next.ambiguities);this.state.resolved=clone(next.resolved||null);
    this.onStatus(`${next.confirmedCount} confirmed · ${next.ambiguousCount||0} ambiguous · ${Math.round((next.stateConfidence||0)*100)}% best-state confidence`);
    if(next.resolved){this.currentTile=null;this.state.currentTile=null;this.flushState();await Promise.resolve(this.onResolved(this.serialise()));this.render();return;}
    this.currentTile=next.nextTile;this.state.currentTile=this.currentTile;this.setInitialPan(false);this.flushState();this.render();
  }

  async unassignCurrent(){
    const confirmations={...(this.analysis.confirmations||{})},ambiguities={...(this.analysis.ambiguities||{})};delete confirmations[this.currentTile];delete ambiguities[this.currentTile];
    const next=await this.analyse(confirmations,ambiguities);if(!next.ok)return;
    this.analysis=next;this.state.confirmations=clone(next.confirmations);this.state.ambiguities=clone(next.ambiguities);this.state.resolved=clone(next.resolved||null);this.setInitialPan(false);this.flushState();this.render();
  }

  nextQuestion(){
    const candidates=Object.values(this.analysis.stickers||{}).filter(item=>(item.status==="unresolved"||item.status==="ambiguous")&&item.tile!==this.currentTile).sort((a,b)=>(a.status==="ambiguous")-(b.status==="ambiguous")||b.priority-a.priority||a.tile-b.tile);
    if(candidates.length)this.selectTile(candidates[0].tile);
  }
}
