const NativeWorker=window.Worker;
const state={worker:null,variants:[],index:0,originalTiles:null,preview:false,busy:false};

function installStyles(){
  if(document.querySelector("#solution-controls-styles"))return;
  const style=document.createElement("style");
  style.id="solution-controls-styles";
  style.textContent=`
    .solution-variant-controls{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-top:.45rem}
    .solution-variant-controls[hidden]{display:none}
    .solution-variant-label{min-width:8.5rem;text-align:center;font-size:.76rem;font-weight:800}
    .solution-preview-actions{display:grid;gap:.45rem;margin-top:.45rem}
    .solution-preview-actions .pages-button{width:100%;justify-content:center}
  `;
  document.head.appendChild(style);
}

function cleanVariant(result){
  if(!result||typeof result!=="object")return result;
  const clean={...result};
  delete clean.alternative_solutions;
  delete clean.__solutionUiSynthetic;
  return clean;
}

function inheritPresentation(primary,alternative){
  const inherited={semantic_reference:primary?.semantic_reference,solved_picture_target:primary?.solved_picture_target,solved_picture_face_order:primary?.solved_picture_face_order,visual_ensemble:primary?.visual_ensemble};
  const out={...inherited,...alternative};
  if(!out.semantic_reference)out.semantic_reference=primary?.semantic_reference;
  return out;
}

function captureSolution(result){
  const alternatives=Array.isArray(result?.alternative_solutions)?result.alternative_solutions:[],primary=cleanVariant(result);
  state.variants=[primary,...alternatives.map(item=>cleanVariant(inheritPresentation(primary,item)))].filter(Boolean);
  state.index=0;state.preview=false;
  state.originalTiles=Array.isArray(window.__lastTileCanvases)?window.__lastTileCanvases.slice():window.__lastTileCanvases||null;
  queueMicrotask(renderControls);
}

function captureWorker(worker,url){
  if(!String(url||"").includes("solver-worker.js"))return;
  state.worker=worker;
  worker.addEventListener("message",event=>{
    const msg=event.data||{};
    if(msg.type!=="solution"||msg.result?.__solutionUiSynthetic)return;
    captureSolution(msg.result);
  });
}

window.Worker=new Proxy(NativeWorker,{
  construct(Target,args,newTarget){
    const worker=Reflect.construct(Target,args,newTarget===window.Worker?Target:newTarget);
    captureWorker(worker,args[0]);
    return worker;
  },
});

function dispatchVariant(result){
  if(!state.worker||!result)return;
  const synthetic={...cleanVariant(result),__solutionUiSynthetic:true};
  window.__lastTileCanvases=state.originalTiles;
  state.worker.dispatchEvent(new MessageEvent("message",{data:{type:"solution",result:synthetic}}));
  queueMicrotask(renderControls);
}

function ensureControls(){
  installStyles();
  const panel=document.querySelector("#result-panel");if(!panel)return null;
  let variants=panel.querySelector("[data-solution-variants]");
  if(!variants){
    variants=document.createElement("div");variants.className="solution-variant-controls";variants.dataset.solutionVariants="";
    const previous=document.createElement("button");previous.type="button";previous.className="pages-button pages-button--quiet";previous.dataset.solutionVariantPrev="";previous.textContent="←";previous.setAttribute("aria-label","Previous possible solution");
    const label=document.createElement("span");label.className="solution-variant-label";label.dataset.solutionVariantLabel="";
    const next=document.createElement("button");next.type="button";next.className="pages-button pages-button--quiet";next.dataset.solutionVariantNext="";next.textContent="→";next.setAttribute("aria-label","Next possible solution");
    previous.addEventListener("click",()=>selectVariant(-1));next.addEventListener("click",()=>selectVariant(1));variants.append(previous,label,next);
    panel.querySelector(".result-head > div")?.appendChild(variants);
  }
  let actions=panel.querySelector("[data-solution-preview-actions]");
  if(!actions){
    actions=document.createElement("div");actions.className="solution-preview-actions";actions.dataset.solutionPreviewActions="";
    const button=document.createElement("button");button.type="button";button.className="pages-button pages-button--quiet";button.dataset.showSolvedCube="";button.textContent="Show solved cube";button.addEventListener("click",()=>toggleSolvedPreview());actions.appendChild(button);
    panel.querySelector(".move-panel")?.appendChild(actions);
  }
  return{panel,variants,actions};
}

function renderControls(){
  const ui=ensureControls();if(!ui)return;
  const count=state.variants.length,index=Math.min(state.index,Math.max(0,count-1));state.index=index;
  ui.variants.hidden=count<=1;
  const result=state.variants[index],confidence=Number(result?.confidence),confidenceText=Number.isFinite(confidence)?` · ${Math.round(confidence*100)}%`:"";
  const label=ui.variants.querySelector("[data-solution-variant-label]");if(label)label.textContent=count>1?`Solution ${index+1} of ${count}${confidenceText}`:"";
  const prev=ui.variants.querySelector("[data-solution-variant-prev]"),next=ui.variants.querySelector("[data-solution-variant-next]");
  if(prev)prev.disabled=state.busy||count<=1;if(next)next.disabled=state.busy||count<=1;
  const preview=ui.actions.querySelector("[data-show-solved-cube]");if(preview){preview.disabled=state.busy||!count;preview.textContent=state.preview?"Back to moves":"Show solved cube";}
  if(count>1&&!state.preview)ui.variants.title=`Ranked mechanically legal solution ${index+1}/${count}${confidenceText}`;
}

function selectVariant(delta){
  if(state.busy||state.variants.length<=1)return;
  state.preview=false;
  const count=state.variants.length;state.index=(state.index+delta+count)%count;
  dispatchVariant(state.variants[state.index]);
}

function setPreviewMoveControls(disabled){
  for(const selector of["#prev-move","#play-moves","#next-move","#reset-playback"]){const element=document.querySelector(selector);if(element)element.disabled=disabled;}
}

async function toggleSolvedPreview(){
  if(state.busy||!state.variants.length)return;
  state.busy=true;renderControls();
  try{
    if(state.preview){
      state.preview=false;dispatchVariant(state.variants[state.index]);return;
    }
    const view=window.__activePictureCubeView,result=state.variants[state.index],size=Number(document.querySelector("#cube-size")?.value||3);
    if(!view||typeof view.showMovesInstant!=="function"||!state.originalTiles){
      const detail=document.querySelector("#move-detail");if(detail)detail.textContent="The instant solved preview is not ready yet.";return;
    }
    view.build(state.originalTiles,size);
    if(!view.showMovesInstant(result.moves||[]))return;
    state.preview=true;setPreviewMoveControls(true);
    const count=result.move_count??(result.moves||[]).length,summary=document.querySelector("#result-summary"),moveText=document.querySelector("#move-text"),detail=document.querySelector("#move-detail");
    if(summary)summary.textContent=`${count} moves · solved preview${state.variants.length>1?` · solution ${state.index+1}/${state.variants.length}`:""}`;
    if(moveText)moveText.textContent="Solved preview ✓";
    if(detail)detail.textContent="Final 3D state shown immediately. Back to moves returns to the start of this solution.";
  }catch(error){
    console.warn("Could not show solved cube instantly",error);
    const detail=document.querySelector("#move-detail");if(detail)detail.textContent=error instanceof Error?error.message:String(error);
  }finally{state.busy=false;renderControls();}
}
