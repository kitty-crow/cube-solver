const NativeWorker=window.Worker;
const state={
  worker:null,variants:[],index:0,originalTiles:null,preview:false,busy:false,
  route:null,routeIndex:0,routePlaying:false,
};

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

function clearTweakRoute(){
  state.route=null;
  state.routeIndex=0;
  state.routePlaying=false;
  state.preview=false;
}

function captureSolution(result){
  clearTweakRoute();
  const alternatives=Array.isArray(result?.alternative_solutions)?result.alternative_solutions:[],primary=cleanVariant(result);
  state.variants=[primary,...alternatives.map(item=>cleanVariant(inheritPresentation(primary,item)))].filter(Boolean);
  state.index=0;state.preview=false;
  state.originalTiles=Array.isArray(window.__lastTileCanvases)?window.__lastTileCanvases.slice():window.__lastTileCanvases||null;
  window.dispatchEvent(new CustomEvent("picture-main-solution",{detail:{result:primary,variants:state.variants.slice()}}));
  queueMicrotask(renderControls);
}

function showTweakError(result){
  queueMicrotask(()=>{
    const status=document.querySelector("[data-tweak-status]");
    const button=document.querySelector("[data-tweak-calculate]");
    if(status){status.textContent=result?.error||"That tweaked target cannot be reached legally.";status.dataset.ok="false";}
    if(button)button.disabled=true;
  });
}

function captureWorker(worker,url){
  if(!String(url||"").includes("solver-worker.js"))return;
  state.worker=worker;
  window.__pictureCubeSolverWorker=worker;
  worker.addEventListener("message",event=>{
    const msg=event.data||{};
    const kind=msg.result?.kind;
    if(msg.type==="solution"&&(kind==="post-solve-tweak"||kind==="post-solve-tweak-error")){
      event.stopImmediatePropagation?.();
      window.dispatchEvent(new CustomEvent(kind==="post-solve-tweak"?"picture-tweak-solution":"picture-tweak-error",{detail:msg.result}));
      if(kind==="post-solve-tweak-error")showTweakError(msg.result);
      return;
    }
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

function currentRouteMoves(){
  return Array.isArray(state.route?.moves)?state.route.moves:[];
}

function renderRouteUi(){
  if(!state.route)return;
  const moves=currentRouteMoves(),total=moves.length,index=Math.max(0,Math.min(state.routeIndex,total));
  state.routeIndex=index;
  const baseCount=Number(state.route.baseCount)||0,correctionCount=Number(state.route.correctionCount)||0;
  const summary=document.querySelector("#result-summary"),moveText=document.querySelector("#move-text"),detail=document.querySelector("#move-detail");
  const prev=document.querySelector("#prev-move"),next=document.querySelector("#next-move"),play=document.querySelector("#play-moves"),reset=document.querySelector("#reset-playback");

  if(state.preview){
    if(summary)summary.textContent=`${total} moves · final tweaked cube preview`;
    if(moveText)moveText.textContent="Solved preview ✓";
    if(detail)detail.textContent="Final tweaked 3D state shown immediately. Back to moves returns to your current step.";
  }else if(index>=total){
    if(summary)summary.textContent=`${total} moves · ${baseCount} to the original solved checkpoint + ${correctionCount} tweak moves`;
    if(moveText)moveText.textContent="Solved ✓";
    if(detail)detail.textContent=correctionCount?"All original solve and tweak steps are complete.":"Solved.";
  }else{
    if(summary)summary.textContent=`${total} moves · ${baseCount} to the original solved checkpoint + ${correctionCount} tweak moves`;
    if(moveText)moveText.textContent=`${index+1} / ${total} · ${moves[index]}`;
    if(detail){
      if(index<baseCount)detail.textContent=`Original solve · ${baseCount-index} move${baseCount-index===1?"":"s"} to the intermediate solved checkpoint, then ${correctionCount} tweak move${correctionCount===1?"":"s"}.`;
      else if(index===baseCount)detail.textContent=`Original solved checkpoint reached · ${correctionCount} tweak move${correctionCount===1?"":"s"} remaining to reach the corrected picture target.`;
      else detail.textContent=`Tweak correction · ${index-baseCount}/${correctionCount} applied · ${total-index} remaining.`;
    }
  }

  const blocked=state.busy||state.preview;
  if(prev)prev.disabled=blocked||index<=0;
  if(next)next.disabled=blocked||index>=total;
  if(reset)reset.disabled=blocked||index<=0;
  if(play){
    play.disabled=state.preview||(!state.routePlaying&&(state.busy||index>=total||!total));
    play.textContent=state.routePlaying?"Pause":"Play";
  }
}

function renderControls(){
  const ui=ensureControls();if(!ui)return;
  const count=state.variants.length,index=Math.min(state.index,Math.max(0,count-1));state.index=index;
  ui.variants.hidden=Boolean(state.route)||count<=1;
  const result=state.variants[index],confidence=Number(result?.confidence),confidenceText=Number.isFinite(confidence)?` · ${Math.round(confidence*100)}%`:"";
  const label=ui.variants.querySelector("[data-solution-variant-label]");if(label)label.textContent=count>1?`Solution ${index+1} of ${count}${confidenceText}`:"";
  const prev=ui.variants.querySelector("[data-solution-variant-prev]"),next=ui.variants.querySelector("[data-solution-variant-next]");
  if(prev)prev.disabled=state.busy||Boolean(state.route)||count<=1;if(next)next.disabled=state.busy||Boolean(state.route)||count<=1;
  const preview=ui.actions.querySelector("[data-show-solved-cube]");if(preview){preview.disabled=state.busy||!count;preview.textContent=state.preview?"Back to moves":"Show solved cube";}
  if(count>1&&!state.preview&&!state.route)ui.variants.title=`Ranked mechanically legal solution ${index+1}/${count}${confidenceText}`;
  if(state.route)renderRouteUi();
}

function selectVariant(delta){
  if(state.busy||state.route||state.variants.length<=1)return;
  state.preview=false;
  const count=state.variants.length;state.index=(state.index+delta+count)%count;
  dispatchVariant(state.variants[state.index]);
}

function setPreviewMoveControls(disabled){
  for(const selector of["#prev-move","#play-moves","#next-move","#reset-playback"]){const element=document.querySelector(selector);if(element)element.disabled=disabled;}
}

function inverseToken(token){
  const value=String(token||"");
  if(value.endsWith("2"))return value;
  if(value.endsWith("'"))return value.slice(0,-1);
  return `${value}'`;
}

async function restoreRouteCheckpoint(){
  if(!state.route||!state.originalTiles)return false;
  const view=window.__activePictureCubeView,size=Number(document.querySelector("#cube-size")?.value||3),moves=currentRouteMoves().slice(0,state.routeIndex);
  if(!view)return false;
  view.build(state.originalTiles,size);
  if(moves.length){
    if(typeof view.showMovesInstant==="function")return view.showMovesInstant(moves)!==false;
    for(const move of moves)await view.move(move);
  }
  return true;
}

async function routeNext(){
  const moves=currentRouteMoves(),view=window.__activePictureCubeView;
  if(!state.route||state.busy||state.preview||state.routeIndex>=moves.length||!view)return;
  state.busy=true;renderRouteUi();
  try{await view.move(moves[state.routeIndex]);state.routeIndex+=1;}
  finally{state.busy=false;renderControls();}
}

async function routePrevious(){
  const moves=currentRouteMoves(),view=window.__activePictureCubeView;
  if(!state.route||state.busy||state.preview||state.routeIndex<=0||!view)return;
  state.busy=true;renderRouteUi();
  try{
    const token=moves[state.routeIndex-1];
    if(typeof view.inverseMove==="function")await view.inverseMove(token);
    else await view.move(inverseToken(token));
    state.routeIndex-=1;
  }finally{state.busy=false;renderControls();}
}

async function routeReset(){
  if(!state.route||state.busy||state.preview)return;
  state.routePlaying=false;state.busy=true;renderRouteUi();
  try{
    const view=window.__activePictureCubeView,size=Number(document.querySelector("#cube-size")?.value||3);
    if(view&&state.originalTiles)view.build(state.originalTiles,size);
    state.routeIndex=0;
  }finally{state.busy=false;renderControls();}
}

async function toggleRoutePlay(){
  if(!state.route||state.preview)return;
  if(state.routePlaying){state.routePlaying=false;renderRouteUi();return;}
  if(state.busy||state.routeIndex>=currentRouteMoves().length)return;
  state.routePlaying=true;renderRouteUi();
  while(state.routePlaying&&state.routeIndex<currentRouteMoves().length){
    await routeNext();
    if(state.routePlaying)await new Promise(resolve=>setTimeout(resolve,120));
  }
  state.routePlaying=false;renderControls();
}

function consumeRouteControl(event){
  if(!state.route)return;
  const button=event.target?.closest?.("#prev-move,#play-moves,#next-move,#reset-playback");
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(button.id==="prev-move")void routePrevious();
  else if(button.id==="next-move")void routeNext();
  else if(button.id==="reset-playback")void routeReset();
  else if(button.id==="play-moves")void toggleRoutePlay();
}
document.addEventListener("click",consumeRouteControl,true);

async function toggleSolvedPreview(){
  if(state.busy||!state.variants.length)return;
  state.busy=true;renderControls();
  try{
    const view=window.__activePictureCubeView,size=Number(document.querySelector("#cube-size")?.value||3);
    if(state.route){
      if(state.preview){
        state.preview=false;
        await restoreRouteCheckpoint();
        return;
      }
      if(!view||typeof view.showMovesInstant!=="function"||!state.originalTiles){
        const detail=document.querySelector("#move-detail");if(detail)detail.textContent="The instant solved preview is not ready yet.";return;
      }
      view.build(state.originalTiles,size);
      if(!view.showMovesInstant(currentRouteMoves()))return;
      state.preview=true;return;
    }
    if(state.preview){
      state.preview=false;dispatchVariant(state.variants[state.index]);return;
    }
    const result=state.variants[state.index];
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

function appendTweakRoute(result){
  if(!result||!state.variants.length)return false;
  const correctionMoves=Array.isArray(result.moves)?result.moves.slice():[];
  const base=cleanVariant(state.variants[state.index]);
  const baseMoves=Array.isArray(base?.moves)?base.moves.slice():[];
  const moves=[...baseMoves,...correctionMoves];
  const composite={
    ...base,
    moves,
    move_count:moves.length,
    post_solve_tweak:result,
  };
  state.variants[state.index]=composite;
  state.route={moves,baseCount:baseMoves.length,correctionCount:correctionMoves.length,result};
  state.routeIndex=baseMoves.length;
  state.routePlaying=false;
  state.preview=false;
  renderControls();
  document.querySelector("#result-panel")?.scrollIntoView?.({behavior:"smooth",block:"start"});
  window.dispatchEvent(new CustomEvent("picture-tweak-route-installed",{detail:{baseCount:baseMoves.length,correctionCount:correctionMoves.length,total:moves.length,result}}));
  return true;
}

window.pictureSolutionControls={
  appendTweakRoute,
  clearTweakRoute,
  get route(){return state.route;},
  get routeIndex(){return state.routeIndex;},
};
