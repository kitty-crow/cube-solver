import { StickerIdentificationModal as BaseStickerIdentificationModal } from "./sticker-identification-ui.js";
import { prepareFacePixels, renderCubemapPan } from "./sticker-cubemap-view.js";

export class StickerIdentificationModal extends BaseStickerIdentificationModal{
  async open(options={}){
    this.facePixels=null;
    await super.open(options);
    this.facePixels=prepareFacePixels(this.faceImages,256);
    this.renderViewer();
  }

  renderViewer(){
    if(!this.facePixels){
      super.renderViewer();
      return;
    }
    renderCubemapPan(this.referenceCanvas,this.facePixels,this.pan,this.quarterTurn);
    const overlay=this.overlayCanvas,octx=overlay.getContext("2d",{alpha:true});
    octx.clearRect(0,0,overlay.width,overlay.height);
    if(this.overlayOpacity>0&&this.scanTiles?.[this.currentTile]){
      octx.globalAlpha=this.overlayOpacity;
      octx.drawImage(this.scanTiles[this.currentTile],0,0,overlay.width,overlay.height);
      octx.globalAlpha=1;
    }
  }
}
