import { ReferenceAlignmentModal as SmoothReferenceAlignmentModal } from "./reference-aligner-v2.js";
import { ReferenceAlignmentModal as BaseReferenceAlignmentModal } from "./reference-aligner.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const DEG=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(v)=>((v%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
const cloneOrientation=(v)=>({yaw:Number(v?.yaw||0),pitch:Number(v?.pitch||0),roll:Number(v?.roll||0)});
const cloneWarps=(warps)=>Object.fromEntries(FACE_NAMES.map(face=>[face,{points:Array.from({length:9},(_,i)=>{
  const p=warps?.[face]?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];
})}]));
const normaliseAngleDelta=(value)=>{let v=value;while(v>Math.PI)v-=Math.PI*2;while(v< -Math.PI)v+=Math.PI*2;return v;};

function transformWarp(warp,{scale=1,angle=0,tx=0,ty=0}={}){
  const c=Math.cos(-angle),s=Math.sin(-angle),safeScale=clamp(Number(scale)||1,.25,4);
  return{points:Array.from({length:9},(_,i)=>{
    const col=i%3,row=Math.floor(i/3),bx=col/2,by=row/2,p=warp?.points?.[i]||[0,0];
    let sx=bx-(Number(p[0])||0),sy=by-(Number(p[1])||0);
    sx-=tx;sy-=ty;
    const x=(sx-.5)/safeScale,y=(sy-.5)/safeScale;
    sx=.5+c*x-s*y;sy=.5+s*x+c*y;
    return[clamp(bx-sx,-.42,.42),clamp(by-sy,-.42,.42)];
  })};
}

function estimatedScale(warp){
  const p=warp?.points||[];
  if(p.length<9)return 1;
  const source=(i)=>{const col=i%3,row=Math.floor(i/3),d=p[i]||[0,0];return[col/2-(Number(d[0])||0),row/2-(Number(d[1])||0)];};
  const l=source(3),r=source(5),t=source(1),b=source(7);
  const sx=1/Math.max(.05,Math.hypot(r[0]-l[0],r[1]-l[1]));
  const sy=1/Math.max(.05,Math.hypot(b[0]-t[0],b[1]-t[1]));
  return clamp((sx+sy)/2,.25,4);
}

export class ReferenceAlignmentModal extends SmoothReferenceAlignmentModal{
  async open(options){
    await super.open(options);
    this.viewZoom=1;
    this.draw();
  }

  setMode(mode){
    super.setMode(mode);
    this.hintEl.textContent=this.mode==="global"
      ?"The photographed cube is fixed. Drag, pinch and twist only the internet artwork overlay: drag moves it around the cube, pinch scales the overlay, and twist rotates it."
      :"The photographed face is fixed. Drag the overlay or its mesh handles; pinch scales only this face and a two-finger twist rotates only this face.";
  }

  beginGesture(){
    const entries=[...this.activePointers.entries()].slice(0,2);if(entries.length<2)return;
    const[[idA,a],[idB,b]]=entries;
    this.drag=null;
    this.gesture={
      ids:[idA,idB],
      startCentroid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},
      startDistance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),
      startAngle:Math.atan2(b.y-a.y,b.x-a.x),
      orientation:cloneOrientation(this.orientation),
      warps:cloneWarps(this.faceWarps),
      faceIndex:this.faceIndex,
      mode:this.mode,
    };
  }

  pointerMove(event){
    if(!this.activePointers.has(event.pointerId))return;
    event.preventDefault();
    const raw=this.rawPointerPosition(event);this.activePointers.set(event.pointerId,raw);

    if(this.activePointers.size>=2&&this.gesture){
      const a=this.activePointers.get(this.gesture.ids[0]),b=this.activePointers.get(this.gesture.ids[1]);if(!a||!b)return;
      const centroid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),angle=Math.atan2(b.y-a.y,b.x-a.x);
      const dx=centroid.x-this.gesture.startCentroid.x,dy=centroid.y-this.gesture.startCentroid.y;
      const scale=clamp(distance/this.gesture.startDistance,.25,4),rotation=normaliseAngleDelta(angle-this.gesture.startAngle);

      if(this.gesture.mode==="global"){
        const sensitivity=.045*DEG;
        this.orientation.yaw=wrap(this.gesture.orientation.yaw+dx*sensitivity);
        this.orientation.pitch=clamp(this.gesture.orientation.pitch-dy*sensitivity,-Math.PI/2,Math.PI/2);
        this.orientation.roll=wrap(this.gesture.orientation.roll+rotation);
        this.faceWarps=Object.fromEntries(FACE_NAMES.map(face=>[face,transformWarp(this.gesture.warps[face],{scale})]));
      }else{
        this.orientation=cloneOrientation(this.gesture.orientation);
        this.faceWarps=cloneWarps(this.gesture.warps);
        const face=FACE_NAMES[this.gesture.faceIndex],tx=dx/this.canvas.width,ty=dy/this.canvas.height;
        this.faceWarps[face]=transformWarp(this.gesture.warps[face],{scale,angle:rotation,tx,ty});
      }
      this.changed();return;
    }

    super.pointerMove(event);
  }

  zoomView(factor){
    const f=clamp(Number(factor)||1,.5,2),snapshot=cloneWarps(this.faceWarps);
    if(this.mode==="global")this.faceWarps=Object.fromEntries(FACE_NAMES.map(face=>[face,transformWarp(snapshot[face],{scale:f})]));
    else{
      const face=FACE_NAMES[this.faceIndex];
      this.faceWarps[face]=transformWarp(snapshot[face],{scale:f});
    }
    this.viewZoom=1;
    this.changed();
  }

  drawFace(){
    // The scan photograph is the immutable registration target. Only worker-generated
    // internet artwork previews and their mapping parameters are ever manipulated.
    this.viewZoom=1;
    BaseReferenceAlignmentModal.prototype.drawFace.call(this);
  }

  updateReadout(){
    BaseReferenceAlignmentModal.prototype.updateReadout.call(this);
    const face=FACE_NAMES[this.faceIndex],scale=estimatedScale(this.faceWarps?.[face]);
    this.readoutEl.textContent+=` · overlay scale ~${scale.toFixed(2)}×`;
  }
}
