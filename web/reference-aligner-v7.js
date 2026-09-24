import { ReferenceAlignmentModal as AllowedReferenceAlignmentModal } from "./reference-aligner-v6.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const GLOBAL_TRANSFORMS=new Set(["move","rotate","scale","yaw","pitch","roll"]);

const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const cloneWarp=(value)=>({points:Array.from({length:9},(_,i)=>{
  const p=value?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];
})});
const cloneWarps=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(value?.[face])]));
const cloneFaceOrientations=(value,fallback)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.[face]||fallback)]));

/*
 * The reference is ONE texture wrapped over ONE cube surface. Faces are not six
 * independent cameras. A rigid cube pose is global; local face refinement may
 * only bend the interior of a face while its four edges stay on the shared cube
 * seams. Keeping all edge control points fixed eliminates the old edge-clamping
 * failure where exhausted source pixels were stretched across a face.
 */
function seamSafeWarp(value){
  const source=cloneWarp(value),points=Array.from({length:9},()=>[0,0]);
  const centre=source.points[4]||[0,0];
  points[4]=[
    Math.max(-.40,Math.min(.40,Number(centre[0])||0)),
    Math.max(-.40,Math.min(.40,Number(centre[1])||0)),
  ];
  return{points};
}
const seamSafeWarps=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,seamSafeWarp(value?.[face])]));

export class ReferenceAlignmentModal extends AllowedReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    this.onDraft=options.onDraft||(()=>{});
    this.draftTimer=null;
  }

  makeRoot(){
    const root=super.makeRoot();
    const globalButton=root.querySelector('[data-align-mode="global"]');
    const faceButton=root.querySelector('[data-align-mode="face"]');
    if(globalButton)globalButton.textContent="Align cube";
    if(faceButton)faceButton.textContent="Refine selected face";
    const label=root.querySelector(".reference-aligner__lockbar-label");
    if(label)label.textContent="Allowed adjustments (cube-wide except Warp):";
    return root;
  }

  anyFaceLocked(){return FACE_NAMES.some(face=>this.isFaceLocked(face));}

  enforceCubeTopology(){
    this.faceWarps=seamSafeWarps(this.faceWarps);
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)]));
  }

  async open(options={}){
    await super.open(options);
    this.enforceCubeTopology();
    this.setMode(this.mode);
    this.updateLockControls();
    this.draw();
    this.schedulePreview(0);
  }

  adjustmentPayload(){
    this.enforceCubeTopology();
    const payload=super.adjustmentPayload();
    return{
      ...payload,
      orientation:cloneOrientation(this.orientation),
      faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)])),
      faceWarps:seamSafeWarps(this.faceWarps),
      topology:{
        kind:"continuous-cube-surface",
        rigidPose:true,
        sharedSeams:true,
        independentFaceCameras:false,
        sourceOverlapAllowed:false,
        edgeStretchAllowed:false,
      },
    };
  }

  queueDraft(){
    clearTimeout(this.draftTimer);
    this.draftTimer=setTimeout(()=>{
      if(this.root?.hidden)return;
      try{
        this.onDraft({
          projection:this.adjustmentPayload(),
          mode:this.mode,
          face:FACE_NAMES[this.faceIndex],
        });
      }catch(error){console.warn("Could not autosave reference draft",error);}
    },180);
  }

  changed(){
    this.enforceCubeTopology();
    super.changed();
    this.queueDraft();
  }

  toggleTransformLock(key){
    if(!GLOBAL_TRANSFORMS.has(key)){
      super.toggleTransformLock(key);
      return;
    }
    const next=!this.isTransformAllowed(this.currentFace(),key);
    this.transformAllows??={};
    for(const face of FACE_NAMES){
      this.transformAllows[face]??={};
      this.transformAllows[face][key]=next;
    }
    this.syncLegacyLocks();
    this.updateLockControls();
    this.changed();
  }

  updateLockControls(){
    super.updateLockControls();
    if(!this.root)return;
    const anchored=this.anyFaceLocked();
    for(const button of this.root.querySelectorAll("[data-align-transform-lock]")){
      const key=button.dataset.alignTransformLock;
      if(!GLOBAL_TRANSFORMS.has(key))continue;
      const base=button.textContent.replace(/\s*\(cube\)$/i,"");
      button.textContent=`${base} (cube)`;
      if(anchored){
        button.disabled=true;
        button.title="A locked face anchors the rigid cube pose. Unlock all faces before changing cube-wide placement.";
      }
    }
  }

  setMode(mode){
    super.setMode(mode);
    const face=this.currentFace();
    if(this.mode==="global"){
      this.hintEl.textContent="This is one texture wrapped around one cube. Dragging or rotating any face changes the rigid pose of the whole cube, so all six faces remain connected.";
    }else if(this.isFaceLocked(face)){
      this.hintEl.textContent=`${FACE_LABELS[face]} is locked at its exact mapping. Unlock it before local refinement.`;
    }else if(this.anyFaceLocked()){
      this.hintEl.textContent="Locked faces anchor the cube pose. You can still refine the selected face interior with Warp, but cube-wide placement stays fixed.";
    }else{
      this.hintEl.textContent="Placement, rotation and scale are cube-wide because all six faces are one connected surface. Local Warp refines only this face interior; its edges stay fixed to the neighbouring faces.";
    }
    this.updateLockControls();
  }

  beginSingleDrag(pointerId,raw){
    super.beginSingleDrag(pointerId,raw);
    if(!this.drag)return;
    if(this.drag.kind==="handle"){
      if(this.drag.handle!==4){
        this.drag=null;
        this.statusEl.textContent="Cube seams are shared with neighbouring faces. Refine the face interior with the centre warp handle instead.";
      }
      return;
    }
    if(this.drag.kind==="face"){
      if(this.anyFaceLocked()){
        this.drag=null;
        this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before moving the wrapped image around the cube.";
        return;
      }
      this.drag.kind="global";
      this.drag.orientation=cloneOrientation(this.orientation);
      this.drag.faceOrientations=cloneFaceOrientations(this.faceOrientations,this.orientation);
      this.drag.warps=cloneWarps(this.faceWarps);
    }
  }

  beginGesture(){
    super.beginGesture();
    if(!this.gesture)return;
    if(this.anyFaceLocked()){
      this.gesture=null;
      this.drag=null;
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before rotating or scaling the wrapped cube.";
      return;
    }
    this.gesture.mode="global";
  }

  applyGlobalSnapshot(snapshot,change={}){
    if(this.anyFaceLocked())return;
    super.applyGlobalSnapshot(snapshot,change);
    this.enforceCubeTopology();
  }

  applyOrientationDelta(yawDelta=0,pitchDelta=0,rollDelta=0){
    if(this.anyFaceLocked()){
      this.statusEl.textContent="A locked face anchors the cube pose. Unlock all faces before changing cube orientation.";
      return false;
    }
    const oldMode=this.mode;
    this.mode="global";
    const result=super.applyOrientationDelta(yawDelta,pitchDelta,rollDelta);
    this.mode=oldMode;
    this.enforceCubeTopology();
    return result;
  }

  resetFace(){
    const face=this.currentFace();
    if(this.isFaceLocked(face)){
      this.statusEl.textContent=`Unlock ${face} before resetting it`;
      return;
    }
    this.faceWarps[face]=seamSafeWarp(null);
    this.changed();
    this.statusEl.textContent=`${FACE_LABELS[face]} local refinement reset; cube placement preserved`;
  }

  resetAll(){
    if(this.anyFaceLocked()){
      for(const face of FACE_NAMES)if(!this.isFaceLocked(face))this.faceWarps[face]=seamSafeWarp(null);
      this.changed();
      this.statusEl.textContent="Unlocked local refinements reset. Locked faces keep the cube pose anchored.";
      return;
    }
    this.orientation=cloneOrientation(this.autoOrientation);
    this.faceWarps=seamSafeWarps(null);
    this.faceOrientations=Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(this.orientation)]));
    this.changed();
    this.statusEl.textContent="Whole cube wrap reset to automatic alignment";
  }

  updateReadout(){
    super.updateReadout();
    if(this.readoutEl)this.readoutEl.textContent+=` · topology one cube / shared seams${this.anyFaceLocked()?" · pose anchored":""}`;
  }
}
