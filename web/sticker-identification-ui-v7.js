import { StickerIdentificationModal as ReviewableStickerIdentificationModal } from "./sticker-identification-ui-v6.js";
import { CORNER_FACELETS, EDGE_FACELETS, labelForFacelet } from "./sticker-constraints-v3.js";
import { compatibleReferenceTargets } from "./sticker-authoritative-override.js";

const clone=value=>value==null?value:structuredClone(value);
const geometryQuarterFromUi=rotation=>((4-(((Number(rotation)||0)%4+4)%4))%4);

function pieceFor(tile){
  const value=Number(tile);
  let index=EDGE_FACELETS.findIndex(piece=>piece.includes(value));
  if(index>=0)return{family:"edge",index,tiles:EDGE_FACELETS[index]};
  index=CORNER_FACELETS.findIndex(piece=>piece.includes(value));
  if(index>=0)return{family:"corner",index,tiles:CORNER_FACELETS[index]};
  return null;
}
function pieceKey(tile){const piece=pieceFor(tile);return piece?`${piece.family}:${piece.index}`:null;}
function samePlacement(a,b){return Number(a?.target)===Number(b?.target)&&Number(a?.rotation)===Number(b?.rotation);}

export class StickerIdentificationModal extends ReviewableStickerIdentificationModal{
  async open(options={}){
    await super.open(options);
    // v1 of the UI restored hard confirmations before the soft-hint layer was
    // introduced. Always re-run the current saved state with both inputs so an
    // imported/reloaded job behaves exactly like the session that produced it.
    const confirmations=clone(this.state?.confirmations||{}),ambiguities=clone(this.state?.ambiguities||options.state?.ambiguities||{});
    const analysis=await this.analyse(confirmations,ambiguities).catch(()=>null);
    if(analysis?.ok){
      this.analysis=analysis;
      this.state.confirmations=clone(analysis.confirmations||{});
      this.state.ambiguities=clone(analysis.ambiguities||{});
      this.state.resolved=clone(analysis.resolved||null);
      const wanted=Number(options.state?.currentTile);
      if(Number.isInteger(wanted)&&analysis.stickers?.[wanted])this.currentTile=wanted;
      else if(this.currentTile==null&&analysis.nextTile!=null)this.currentTile=analysis.nextTile;
      this.state.currentTile=this.currentTile;
      this.setInitialPan(Boolean(options.state?.pan));
      this.render();
      this.queueSave();
    }
  }

  render(){
    if(!this.analysis)return super.render();
    // "Ready to solve" must never mean "locked for editing". A probable state
    // can still contain soft ambiguities, and even an exact state may need a
    // human correction. Render the editor as editable, then restore the solve
    // readiness metadata and its banner.
    const resolved=this.analysis.resolved||null;
    this.analysis.resolved=null;
    try{super.render();}
    finally{this.analysis.resolved=resolved;}
    if(resolved){
      this.resolvedEl.hidden=false;
      const confidence=Math.round(Number(resolved.confidence??this.analysis.stateConfidence??1)*100);
      this.resolvedEl.textContent=resolved.exact
        ?"Unique legal scramble found. You can still review, unassign or override any sticker before solving."
        :`High-confidence legal scramble ready (${confidence}%). Ambiguous answers remain soft evidence and may still move when stronger assignments or cube mechanics require it.`;
    }
    this.renderOverrideControls();
  }

  pointerDown(event){
    const resolved=this.analysis?.resolved||null;
    if(!resolved)return super.pointerDown(event);
    this.analysis.resolved=null;
    try{return super.pointerDown(event);}finally{this.analysis.resolved=resolved;}
  }

  async confirmCurrent(){
    const hadResolved=this.analysis?.resolved||null;
    if(!hadResolved)return super.confirmCurrent();
    this.analysis.resolved=null;
    try{await super.confirmCurrent();}
    finally{
      if(this.analysis&&this.analysis!==null&&this.analysis.resolved==null&&this.state?.resolved&&this.analysis===undefined)this.analysis.resolved=hadResolved;
      if(this.analysis?.resolved&&!this.analysis.resolved.exact&&this.currentTile==null&&this.analysis.nextTile!=null){this.currentTile=this.analysis.nextTile;this.state.currentTile=this.currentTile;this.setInitialPan(false);}
      this.render();
    }
  }

  async markAmbiguous(){
    const hadResolved=this.analysis?.resolved||null;
    if(!hadResolved)return super.markAmbiguous();
    this.analysis.resolved=null;
    try{await super.markAmbiguous();}
    finally{
      if(this.analysis?.resolved&&!this.analysis.resolved.exact&&this.currentTile==null&&this.analysis.nextTile!=null){this.currentTile=this.analysis.nextTile;this.state.currentTile=this.currentTile;this.setInitialPan(false);}
      this.render();
    }
  }

  async unassignCurrent(){
    if(this.currentTile==null)return;
    const tile=Number(this.currentTile),before=this.analysis?.stickers?.[tile],hadExplicit=Boolean(before?.confirmed||before?.ambiguous);
    if(!hadExplicit){
      this.messageEl.textContent=`${labelForFacelet(tile)} is not manually assigned. Its current value is being inferred from the other cube constraints.`;
      return;
    }
    const confirmations=clone(this.analysis.confirmations||{}),ambiguities=clone(this.analysis.ambiguities||{});
    delete confirmations[tile];delete ambiguities[tile];
    this.messageEl.textContent=`Unassigning ${labelForFacelet(tile)} and recalculating the cube…`;
    const next=await this.analyse(confirmations,ambiguities).catch(error=>({ok:false,conflict:error.message}));
    if(!next?.ok){this.messageEl.textContent=next?.conflict||"Could not recalculate after unassigning.";return;}
    this.analysis=next;this.state.confirmations=clone(next.confirmations||{});this.state.ambiguities=clone(next.ambiguities||{});this.state.resolved=clone(next.resolved||null);
    this.currentTile=tile;this.state.currentTile=tile;this.setInitialPan(false);this.flushState();this.render();
    const after=this.analysis.stickers?.[tile];
    if(after?.status==="inferred"&&after.domain?.length===1){
      this.messageEl.textContent=`Unassigned ${labelForFacelet(tile)}. It still appears mapped because the remaining hard assignments mechanically force ${labelForFacelet(after.domain[0].target)}.`;
    }else{
      this.messageEl.textContent=`${labelForFacelet(tile)} is unassigned. It is free to move to any remaining legal state.`;
    }
  }

  async analyseCandidate(confirmations,ambiguities={}){
    const result=await this.analyse(confirmations,ambiguities).catch(error=>({ok:false,conflict:error.message}));
    return result?.ok&&result.legalStateCount?result:null;
  }

  hardGroups(confirmations,authoritativeTile){
    const grouped=new Map();
    for(const[rawTile,value]of Object.entries(confirmations||{})){
      const tile=Number(rawTile);if(tile===Number(authoritativeTile))continue;
      const key=pieceKey(tile);if(!key)continue;
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push([tile,clone(value)]);
    }
    return [...grouped.entries()].map(([key,entries])=>({key,entries,piece:pieceFor(entries[0][0])}));
  }

  async applyAuthoritativeOverride(){
    if(this.currentTile==null)return;
    const tile=Number(this.currentTile),target=Number(this.overrideTarget.value),uiRotation=Number(this.overrideRotation.value),rotation=geometryQuarterFromUi(uiRotation);
    const sourceLabel=labelForFacelet(tile),targetLabel=labelForFacelet(target),compatible=compatibleReferenceTargets(tile);
    if(!compatible.includes(target)){
      this.messageEl.textContent=`${sourceLabel} cannot be ${targetLabel}: edge stickers can only map to edges and corner stickers can only map to corners.`;
      return;
    }

    this.overrideButton.disabled=true;
    this.messageEl.textContent=`Making ${sourceLabel} → ${targetLabel} authoritative…`;
    const authoritative={[tile]:{target,rotation}};
    const isolated=await this.analyseCandidate(authoritative,{});
    if(!isolated){
      this.overrideButton.disabled=false;
      this.messageEl.textContent=`${sourceLabel} → ${targetLabel} is a possible segment identity, but not at ${uiRotation*90}° for this physical cubie. Try another quarter-turn.`;
      return;
    }

    const oldHard=clone(this.analysis.confirmations||{}),oldSoft=clone(this.analysis.ambiguities||{}),accepted=clone(authoritative),removed=[];
    const destination=pieceFor(target),source=pieceFor(tile),groups=this.hardGroups(oldHard,tile);

    // The human's 100% assertion wins first. Re-add every older hard cubie only
    // if it remains compatible with that assertion. Anything that vetoes the
    // new fact is dropped, including indirect parity/orientation conflicts.
    // This is intentionally the opposite of asking the new assertion to fit the
    // previous model.
    groups.sort((a,b)=>{
      const aSibling=a.piece?.family===source?.family&&a.piece?.index===source?.index;
      const bSibling=b.piece?.family===source?.family&&b.piece?.index===source?.index;
      if(aSibling!==bSibling)return Number(bSibling)-Number(aSibling);
      return b.entries.length-a.entries.length;
    });
    for(const group of groups){
      const directCollision=group.entries.some(([,value])=>destination?.tiles?.includes(Number(value?.target)));
      if(directCollision){
        for(const[otherTile,value]of group.entries)removed.push({tile:otherTile,target:value.target,reason:"reference cubie is now authoritatively occupied"});
        continue;
      }
      const tentative={...accepted};for(const[otherTile,value]of group.entries)tentative[otherTile]=clone(value);
      const possible=await this.analyseCandidate(tentative,{});
      if(possible){Object.assign(accepted,Object.fromEntries(group.entries.map(([otherTile,value])=>[otherTile,clone(value)])));}
      else for(const[otherTile,value]of group.entries)removed.push({tile:otherTile,target:value.target,reason:"contradicts the authoritative assignment"});
    }

    // Ambiguous answers are deliberately never used as locks. Keep them only as
    // soft priors; the v3 constraint layer automatically discards any hint that
    // the accepted hard state makes impossible or mechanically redundant.
    delete oldSoft[tile];
    const next=await this.analyseCandidate(accepted,oldSoft);
    if(!next){
      this.overrideButton.disabled=false;
      this.messageEl.textContent=`Could not construct a legal cube around ${sourceLabel} → ${targetLabel}. The selected quarter-turn is the only remaining thing to change.`;
      return;
    }

    const prunedSoft=Object.keys(oldSoft).filter(key=>!Object.prototype.hasOwnProperty.call(next.ambiguities||{},key)).map(Number);
    this.analysis=next;this.state.confirmations=clone(next.confirmations||{});this.state.ambiguities=clone(next.ambiguities||{});this.state.resolved=clone(next.resolved||null);
    this.onStatus(`${next.confirmedCount} confirmed · ${next.ambiguousCount||0} ambiguous · ${Math.round(Number(next.stateConfidence||0)*100)}% best-state confidence`);

    if(next.resolved?.exact){this.currentTile=tile;}
    else this.currentTile=next.nextTile??tile;
    this.state.currentTile=this.currentTile;this.setInitialPan(false);this.flushState();
    if(next.resolved)await Promise.resolve(this.onResolved(this.serialise()));
    this.render();

    const removedText=removed.length?` Unassigned ${removed.map(item=>`${labelForFacelet(item.tile)}→${labelForFacelet(item.target)}`).join(", ")} because ${removed.length===1?"it contradicted":"they contradicted"} the new authoritative fact.`:"";
    const softText=prunedSoft.length?` Released ${prunedSoft.map(labelForFacelet).join(", ")} from ambiguous hints because stronger constraints superseded them.`:"";
    this.messageEl.textContent=`100% authoritative: ${sourceLabel} → ${targetLabel} at ${uiRotation*90}°.${removedText}${softText}`;
  }
}
