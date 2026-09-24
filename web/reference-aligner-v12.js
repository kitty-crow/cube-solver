import { ReferenceAlignmentModal as CrossFaceReferenceAlignmentModal } from "./reference-aligner-v11.js";

const DEG=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(v)=>{const p=Math.PI*2;return((Number(v||0)%p)+p)%p;};
const angleDelta=(v)=>{let x=Number(v||0)% (Math.PI*2);if(x>Math.PI)x-=Math.PI*2;if(x< -Math.PI)x+=Math.PI*2;return x;};
const editableTarget=(target)=>target instanceof HTMLElement&&(target.isContentEditable||["INPUT","TEXTAREA","SELECT"].includes(target.tagName));

export class ReferenceAlignmentModal extends CrossFaceReferenceAlignmentModal{
  pointerMove(event){
    if(!this.activePointers?.has(event.pointerId))return;
    event.preventDefault();
    const raw=this.rawPointerPosition(event);
    this.activePointers.set(event.pointerId,raw);

    // Handle the global transform here, above every historical aligner layer.
    // Older inherited implementations contained ±90° clamps. Keeping this at
    // the leaf class guarantees touch drag and two-finger gestures can never
    // fall through to one of those old latitude-style limits.
    if(this.activePointers.size>=2&&this.gesture?.mode==="global"){
      const a=this.activePointers.get(this.gesture.ids[0]),b=this.activePointers.get(this.gesture.ids[1]);
      if(!a||!b)return;
      const centroid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const distance=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
      const angle=Math.atan2(b.y-a.y,b.x-a.x);
      const dx=centroid.x-this.gesture.startCentroid.x,dy=centroid.y-this.gesture.startCentroid.y;
      const sensitivity=.045*DEG/Math.max(.5,this.viewZoom||1);
      const scale=clamp(distance/this.gesture.startDistance,.25,4);
      this.applyGlobalSnapshot(this.gesture,{
        yawDelta:dx*sensitivity,
        pitchDelta:-dy*sensitivity,
        rollDelta:angleDelta(angle-this.gesture.startAngle),
        scale,
      });
      this.changed();
      return;
    }

    if(this.drag?.kind==="global"&&this.drag.pointerId===event.pointerId){
      const dx=raw.x-this.drag.start.x,dy=raw.y-this.drag.start.y;
      const sensitivity=.045*DEG/Math.max(.5,this.viewZoom||1);
      this.applyGlobalSnapshot(this.drag,{yawDelta:dx*sensitivity,pitchDelta:-dy*sensitivity});
      this.changed();
      return;
    }

    return super.pointerMove(event);
  }

  onWheel(event){
    if(this.root.hidden||!this.canvas.contains(event.target))return;
    event.preventDefault();
    const line=typeof WheelEvent!=="undefined"&&event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:(typeof WheelEvent!=="undefined"&&event.deltaMode===WheelEvent.DOM_DELTA_PAGE?240:1);
    const dx=clamp(event.deltaX*line,-240,240),dy=clamp(event.deltaY*line,-240,240);
    if(event.altKey){this.zoomView(Math.exp(-dy*.0015));return;}
    const sensitivity=.010*DEG/Math.max(.5,this.viewZoom||1);
    if(event.shiftKey)this.applyOrientationDelta(0,0,dy*sensitivity);
    else if(event.ctrlKey||event.metaKey)this.applyOrientationDelta(dy*sensitivity,0,0);
    else this.applyOrientationDelta(dx*sensitivity,dy*sensitivity,0);
  }

  onKeyDown(event){
    if(this.root.hidden||editableTarget(event.target))return;
    const key=String(event.key||"").toLowerCase(),fine=event.shiftKey?.05:.25,step=fine*DEG/Math.max(.5,this.viewZoom||1);
    let handled=true;
    if(key==="arrowleft"||key==="a")this.applyOrientationDelta(-step,0,0);
    else if(key==="arrowright"||key==="d")this.applyOrientationDelta(step,0,0);
    else if(key==="arrowup"||key==="w")this.applyOrientationDelta(0,step,0);
    else if(key==="arrowdown"||key==="s")this.applyOrientationDelta(0,-step,0);
    else if(key==="q")this.applyOrientationDelta(0,0,-step);
    else if(key==="e")this.applyOrientationDelta(0,0,step);
    else if(key==="+"||key==="="){this.zoomView(1.12);}
    else if(key==="-"||key==="_"){this.zoomView(1/1.12);}
    else if(key==="0"){this.viewZoom=1;this.draw();}
    else if(key==="escape"){this.close();}
    else handled=false;
    if(handled)event.preventDefault();
  }

  updateReadout(){
    super.updateReadout();
    if(this.readoutEl)this.readoutEl.textContent+=" · continuous touch/gesture rotation";
  }
}
