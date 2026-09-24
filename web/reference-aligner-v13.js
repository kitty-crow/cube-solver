import { ReferenceAlignmentModal as ContinuousReferenceAlignmentModal } from "./reference-aligner-v12.js";

const FACE_NAMES=["U","R","F","D","L","B"];
const TRANSFORM_KEYS=["move","rotate","scale","warp","yaw","pitch","roll"];
const HISTORY_LIMIT=100;

const cloneOrientation=(value)=>({yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)});
const cloneWarp=(value)=>({points:Array.from({length:9},(_,i)=>{const p=value?.points?.[i]||[0,0];return[Number(p[0])||0,Number(p[1])||0];})});
const cloneWarps=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(value?.[face])]));
const cloneFaceOrientations=(value,fallback)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.[face]||fallback)]));
const cloneFaceLocks=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Boolean(Array.isArray(value)?value.includes(face):value?.[face])]));
const cloneTransformAllows=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[
  face,
  Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,value?.[face]?.[key]!==false])),
]));
const sameState=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export class ReferenceAlignmentModal extends ContinuousReferenceAlignmentModal{
  constructor(options={}){
    super(options);
    this.onDraftImmediate=options.onDraftImmediate||null;
    this.undoStack=[];
    this.redoStack=[];
    this.historyCurrent=null;
    this.historyTimer=null;
    this.historySuspended=false;
    this.updateHistoryButtons();
  }

  makeRoot(){
    const root=super.makeRoot();
    const modeButton=root.querySelector('[data-align-mode="face"]');
    const toolbar=modeButton?.parentElement;
    if(toolbar&&!toolbar.querySelector("[data-align-undo]")){
      const undo=document.createElement("button");
      undo.type="button";
      undo.className="pages-button";
      undo.dataset.alignUndo="";
      undo.textContent="↶ Undo";
      undo.disabled=true;
      undo.setAttribute("aria-label","Undo last alignment change");
      undo.addEventListener("click",()=>this.undoAlignment());

      const redo=document.createElement("button");
      redo.type="button";
      redo.className="pages-button";
      redo.dataset.alignRedo="";
      redo.textContent="↷ Redo";
      redo.disabled=true;
      redo.setAttribute("aria-label","Redo last alignment change");
      redo.addEventListener("click",()=>this.redoAlignment());

      const spacer=toolbar.querySelector(".reference-aligner__spacer");
      toolbar.insertBefore(undo,spacer||null);
      toolbar.insertBefore(redo,spacer||null);
      this.undoButton=undo;
      this.redoButton=redo;
    }
    return root;
  }

  async open(options={}){
    clearTimeout(this.historyTimer);
    this.historyTimer=null;
    this.historySuspended=true;
    this.undoStack=[];
    this.redoStack=[];
    this.historyCurrent=null;
    await super.open(options);
    this.historyCurrent=this.historySnapshot();
    this.historySuspended=false;
    this.updateHistoryButtons();
  }

  close(){
    clearTimeout(this.historyTimer);
    this.historyTimer=null;
    return super.close();
  }

  historySnapshot(){
    return{
      orientation:cloneOrientation(this.orientation),
      sourceScale:Number(this.sourceScale||1),
      faceOrientations:cloneFaceOrientations(this.faceOrientations,this.orientation),
      faceWarps:cloneWarps(this.faceWarps),
      faceLocks:cloneFaceLocks(this.faceLocks),
      transformAllows:cloneTransformAllows(this.transformAllows),
      faceIndex:Number(this.faceIndex||0),
      mode:this.mode==="face"?"face":"global",
    };
  }

  queueHistoryCommit(delay=180){
    if(this.historySuspended)return;
    clearTimeout(this.historyTimer);
    this.historyTimer=setTimeout(()=>{
      this.historyTimer=null;
      this.commitHistoryNow();
    },delay);
  }

  commitHistoryNow(){
    if(this.historySuspended)return false;
    clearTimeout(this.historyTimer);
    this.historyTimer=null;
    const live=this.historySnapshot();
    if(!this.historyCurrent){
      this.historyCurrent=live;
      this.updateHistoryButtons();
      return false;
    }
    if(sameState(live,this.historyCurrent))return false;
    this.undoStack.push(structuredClone(this.historyCurrent));
    if(this.undoStack.length>HISTORY_LIMIT)this.undoStack.shift();
    this.historyCurrent=live;
    this.redoStack=[];
    this.updateHistoryButtons();
    return true;
  }

  changed(){
    super.changed();
    this.queueHistoryCommit();
  }

  pointerUp(event){
    super.pointerUp(event);
    if(!this.activePointers?.size)this.commitHistoryNow();
  }

  updateHistoryButtons(){
    if(this.undoButton)this.undoButton.disabled=!this.undoStack?.length;
    if(this.redoButton)this.redoButton.disabled=!this.redoStack?.length;
  }

  rebuildLockedSnapshots(){
    this.lockedFaceSnapshots={};
    for(const face of FACE_NAMES){
      if(!this.isFaceLocked(face))continue;
      this.lockedFaceSnapshots[face]={
        orientation:cloneOrientation(this.faceOrientations?.[face]||this.orientation),
        warp:cloneWarp(this.faceWarps?.[face]),
        previewImage:null,
      };
    }
  }

  applyHistoryState(state,label){
    if(!state)return;
    clearTimeout(this.historyTimer);
    this.historyTimer=null;
    this.historySuspended=true;
    this.orientation=cloneOrientation(state.orientation);
    this.sourceScale=Number(state.sourceScale||1);
    this.faceOrientations=cloneFaceOrientations(state.faceOrientations,this.orientation);
    this.faceWarps=cloneWarps(state.faceWarps);
    this.faceLocks=cloneFaceLocks(state.faceLocks);
    this.transformAllows=cloneTransformAllows(state.transformAllows);
    this.syncLegacyLocks?.();
    this.rebuildLockedSnapshots();
    this.setFace?.(Math.max(0,Math.min(5,Number(state.faceIndex)||0)));
    this.setMode?.(state.mode==="face"?"face":"global");
    this.updateLockControls?.();
    this.historyCurrent=this.historySnapshot();
    this.historySuspended=false;
    super.changed();
    this.queueDraft?.();
    this.statusEl.textContent=label;
    this.updateHistoryButtons();
  }

  undoAlignment(){
    this.commitHistoryNow();
    if(!this.undoStack.length)return;
    const target=this.undoStack.pop();
    this.redoStack.push(structuredClone(this.historyCurrent));
    if(this.redoStack.length>HISTORY_LIMIT)this.redoStack.shift();
    this.applyHistoryState(target,"Undid alignment change");
  }

  redoAlignment(){
    this.commitHistoryNow();
    if(!this.redoStack.length)return;
    const target=this.redoStack.pop();
    this.undoStack.push(structuredClone(this.historyCurrent));
    if(this.undoStack.length>HISTORY_LIMIT)this.undoStack.shift();
    this.applyHistoryState(target,"Redid alignment change");
  }

  toggleFaceLock(){
    this.commitHistoryNow();
    super.toggleFaceLock();
    this.commitHistoryNow();
    // Locking a face is a checkpoint, not merely an autosave hint. Persist the
    // selected reference image and exact mapping immediately so a reload right
    // after locking cannot lose the work.
    const draft=this.persistedDraft?.();
    if(draft&&this.onDraftImmediate){
      Promise.resolve(this.onDraftImmediate(draft)).then(()=>{
        if(this.isFaceLocked(this.currentFace()))this.statusEl.textContent=`${this.currentFace()} locked and saved for reload`;
      }).catch(error=>console.warn("Could not persist locked reference mapping",error));
    }
  }

  toggleTransformLock(key){
    this.commitHistoryNow();
    super.toggleTransformLock(key);
    this.commitHistoryNow();
  }

  resetFace(){
    this.commitHistoryNow();
    super.resetFace();
    this.commitHistoryNow();
  }

  resetAll(){
    this.commitHistoryNow();
    super.resetAll();
    this.commitHistoryNow();
  }

  onKeyDown(event){
    if(!this.root.hidden&&!event.defaultPrevented&&!event.isComposing){
      const key=String(event.key||"").toLowerCase();
      const target=event.target;
      const editable=target instanceof HTMLElement&&(target.isContentEditable||["INPUT","TEXTAREA","SELECT"].includes(target.tagName));
      if(!editable&&(event.ctrlKey||event.metaKey)&&key==="z"){
        event.preventDefault();
        if(event.shiftKey)this.redoAlignment();else this.undoAlignment();
        return;
      }
      if(!editable&&(event.ctrlKey||event.metaKey)&&key==="y"){
        event.preventDefault();
        this.redoAlignment();
        return;
      }
    }
    return super.onKeyDown(event);
  }
}
