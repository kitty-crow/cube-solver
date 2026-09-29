import { StickerIdentificationModal as AuthoritativeStickerIdentificationModal } from "./sticker-identification-ui-v5.js";

export class StickerIdentificationModal extends AuthoritativeStickerIdentificationModal{
  renderOverrideControls(){
    const resolved=this.analysis?.resolved||null;
    if(!resolved)return super.renderOverrideControls();
    this.analysis.resolved=null;
    try{super.renderOverrideControls();}
    finally{this.analysis.resolved=resolved;}
  }

  async applyAuthoritativeOverride(){
    if(this.currentTile==null)return;
    const original=this.analysis,resolved=original?.resolved||null;
    if(!resolved)return super.applyAuthoritativeOverride();
    original.resolved=null;
    try{await super.applyAuthoritativeOverride();}
    finally{
      if(this.analysis===original&&!this.analysis.resolved)this.analysis.resolved=resolved;
      this.render();
    }
  }
}
