import { ReferenceAlignmentModal as ImmutableReferenceAlignmentModal } from "./reference-aligner-v5.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const TRANSFORM_KEYS=["move","rotate","scale","warp","yaw","pitch","roll"];
const TRANSFORM_LABELS={move:"Translation",rotate:"Rotation",scale:"Scale",warp:"Warp",yaw:"Yaw",pitch:"Pitch",roll:"Roll"};

const emptyAllows=()=>Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,true]));
const cloneAllows=(allows,locks)=>Object.fromEntries(FACE_NAMES.map(face=>[
  face,
  Object.fromEntries(TRANSFORM_KEYS.map(key=>{
    const explicit=allows?.[face]?.[key];
    return[key,explicit===undefined?!Boolean(locks?.[face]?.[key]):Boolean(explicit)];
  })),
]));
const cloneAllowsOnly=(allows)=>Object.fromEntries(FACE_NAMES.map(face=>[
  face,
  Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,allows?.[face]?.[key]!==false])),
]));

export class ReferenceAlignmentModal extends ImmutableReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    this.transformAllows=cloneAllows(null,this.transformLocks);
    this.syncLegacyLocks();
  }

  makeRoot(){
    const root=super.makeRoot();
    const label=root.querySelector(".reference-aligner__lockbar-label");
    if(label)label.textContent="Apply these adjustments to selected face:";
    for(const button of root.querySelectorAll("[data-align-transform-lock]")){
      button.dataset.alignTransformAllow=button.dataset.alignTransformLock;
    }
    return root;
  }

  async open(options={}){
    await super.open(options);
    const projection=options.candidate?.projection||{};
    this.transformAllows=cloneAllows(projection.transformAllows,projection.transformLocks||this.transformLocks);
    this.syncLegacyLocks();
    this.updateLockControls();
    this.setMode(this.mode);
    this.draw();
  }

  syncLegacyLocks(){
    this.transformLocks??={};
    for(const face of FACE_NAMES){
      this.transformLocks[face]??={};
      for(const key of TRANSFORM_KEYS)this.transformLocks[face][key]=!this.isTransformAllowed(face,key);
    }
  }

  isTransformAllowed(face,key){
    if(this.transformAllows?.[face]&&this.transformAllows[face][key]!==undefined)return Boolean(this.transformAllows[face][key]);
    return !Boolean(this.transformLocks?.[face]?.[key]);
  }

  isTransformLocked(face,key){
    return !this.isTransformAllowed(face,key);
  }

  toggleTransformLock(key){
    if(!TRANSFORM_KEYS.includes(key))return;
    const face=this.currentFace();
    this.transformAllows??=cloneAllows(null,this.transformLocks);
    this.transformAllows[face]??=emptyAllows();
    this.transformAllows[face][key]=!this.isTransformAllowed(face,key);
    this.syncLegacyLocks();
    this.updateLockControls();
    this.changed();
  }

  updateLockControls(){
    super.updateLockControls();
    if(!this.root)return;
    const face=this.currentFace();
    const faceLocked=this.isFaceLocked(face);
    for(const button of this.root.querySelectorAll("[data-align-transform-lock]")){
      const key=button.dataset.alignTransformLock;
      const allowed=this.isTransformAllowed(face,key);
      button.textContent=TRANSFORM_LABELS[key]||key;
      button.setAttribute("aria-pressed",String(allowed));
      button.dataset.allowed=String(allowed);
      button.disabled=faceLocked;
      button.title=`${TRANSFORM_LABELS[key]} is ${allowed?"enabled":"disabled"} for ${FACE_LABELS[face]}. Tap to ${allowed?"disable":"enable"} it.`;
      button.setAttribute("aria-label",`${allowed?"Disable":"Enable"} ${String(TRANSFORM_LABELS[key]||key).toLowerCase()} for ${FACE_LABELS[face]} face`);
    }
  }

  setMode(mode){
    super.setMode(mode);
    const face=this.currentFace();
    if(this.mode==="global"){
      this.hintEl.textContent="Global refine changes only unlocked faces, and on each face it applies only the enabled adjustments below.";
    }else if(this.isFaceLocked(face)){
      this.hintEl.textContent=`${FACE_LABELS[face]} is locked at its exact current mapping. Unlock the face before editing it.`;
    }else{
      this.hintEl.textContent="Only the enabled adjustments below may change this face. All adjustments start enabled; turn off anything you want preserved while refining.";
    }
    this.updateLockControls();
  }

  adjustmentPayload(){
    this.syncLegacyLocks();
    const payload=super.adjustmentPayload();
    return{
      ...payload,
      transformAllows:cloneAllowsOnly(this.transformAllows),
      transformLocks:this.transformLocks,
    };
  }

  async handleLockedWorkerMessage(msg){
    const allows=cloneAllowsOnly(this.transformAllows);
    if(msg?.projection)msg.projection.transformAllows=allows;
    if(msg?.candidate?.projection)msg.candidate.projection.transformAllows=allows;
    await super.handleLockedWorkerMessage(msg);
  }
}
