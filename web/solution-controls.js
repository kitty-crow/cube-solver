const NativeWorker=window.Worker;
const FACE_ORDER=["U","R","F","D","L","B"];
const state={worker:null,variants:[],index:0,originalTiles:null,preview:false,busy:false};

function installStyles(){
  if(document.querySelector("#solution-controls-styles"))return;
  const style=document.createElement("style");
  style.id="solution-controls-styles";
  style.textContent=`
    .solution-variant-controls{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-top:.45rem}
    .solution-variant-controls[hidden]{display:none}
    .solution-variant-label{min-width:7rem;text-align:center;font-size:.76rem;font-weight:800}
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
  delete clean.__solvedPreview;
  return clean;
}

function captureSolution(result){
  const alternatives=Array.isArray(result?.alternative_solutions)?result.alternative_solutions:[];
  state.variants=[cleanVariant(result),...alternatives.map(cleanVariant)].filter(Boolean);
  state.index=0;
  state.preview=false;
  state.originalTiles=Array.isArray(window.__lastTileCanvases)?window.__lastTileCanvases.slice():window.__lastTileCanvases||null;
  queueMicrotask(renderControls);
}

function captureWorker(worker,url){
  const href=String(url||"");
  if(!href.includes("solver-worker.js"))return;
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
    previous.addEventListener("click",()=>selectVariant(-1));next.addEventListener("click",()=>selectVariant(1));
    variants.append(previous,label,next);
    panel.querySelector(".result-head > div")?.appendChild(variants);
  }
  let actions=panel.querySelector("[data-solution-preview-actions]");
  if(!actions){
    actions=document.createElement("div");actions.className="solution-preview-actions";actions.dataset.solutionPreviewActions="";
    const button=document.createElement("button");button.type="button";button.className="pages-button pages-button--quiet";button.dataset.showSolvedCube="";button.textContent="Show solved cube";button.addEventListener("click",()=>toggleSolvedPreview());
    actions.appendChild(button);panel.querySelector(".move-panel")?.appendChild(actions);
  }
  return{panel,variants,actions};
}

function renderControls(){
  const ui=ensureControls();if(!ui)return;
  const count=state.variants.length,index=Math.min(state.index,Math.max(0,count-1));state.index=index;
  ui.variants.hidden=count<=1;
  const label=ui.variants.querySelector("[data-solution-variant-label]");if(label)label.textContent=count>1?`Solution ${index+1} of ${count}`:"";
  const prev=ui.variants.querySelector("[data-solution-variant-prev]"),next=ui.variants.querySelector("[data-solution-variant-next]");
  if(prev)prev.disabled=state.busy||count<=1;if(next)next.disabled=state.busy||count<=1;
  const preview=ui.actions.querySelector("[data-show-solved-cube]");if(preview){preview.disabled=state.busy||!count;preview.textContent=state.preview?"Back to moves":"Show solved cube";}
  if(count>1&&!state.preview){
    const result=state.variants[index],confidence=Number(result?.confidence);
    const suffix=Number.isFinite(confidence)?` · ${Math.round(confidence*100)}%`:"";
    ui.variants.title=`Ranked legal solution ${index+1}/${count}${suffix}`;
  }
}

function selectVariant(delta){
  if(state.busy||state.variants.length<=1)return;
  if(state.preview){state.preview=false;window.__lastTileCanvases=state.originalTiles;}
  const count=state.variants.length;state.index=(state.index+delta+count)%count;
  window.__lastTileCanvases=state.originalTiles;
  dispatchVariant(state.variants[state.index]);
}

function loadImage(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("Could not load solved face preview"));image.src=src;});}
function cloneCanvas(source){const canvas=document.createElement("canvas");canvas.width=source.width;canvas.height=source.height;canvas.getContext("2d",{alpha:false}).drawImage(source,0,0);return canvas;}

async function referenceSolvedTiles(result,size){
  const semantic=result?.semantic_reference||{},previews=Array.isArray(semantic.solved_face_previews)?semantic.solved_face_previews:[],order=Array.isArray(semantic.face_order)&&semantic.face_order.length===6?semantic.face_order:FACE_ORDER;
  if(previews.length!==6)return null;
  const images=await Promise.all(previews.map(loadImage)),byFace=new Map(order.map((face,index)=>[String(face),images[index]])),tiles=[];
  for(const face of FACE_ORDER){
    const image=byFace.get(face);if(!image)return null;
    const sw=image.naturalWidth||image.width,sh=image.naturalHeight||image.height;
    for(let row=0;row<size;row++)for(let col=0;col<size;col++){
      const canvas=document.createElement("canvas");canvas.width=Math.max(48,Math.floor(sw/size));canvas.height=Math.max(48,Math.floor(sh/size));
      canvas.getContext("2d",{alpha:false}).drawImage(image,col*sw/size,row*sh/size,sw/size,sh/size,0,0,canvas.width,canvas.height);tiles.push(canvas);
    }
  }
  return tiles;
}

function colourSolvedTiles(size){
  if(size!==3||!Array.isArray(state.originalTiles)||state.originalTiles.length<54)return null;
  const tiles=[];
  for(let face=0;face<6;face++){
    const centre=state.originalTiles[face*9+4];if(!centre)return null;
    for(let local=0;local<9;local++)tiles.push(cloneCanvas(centre));
  }
  return tiles;
}

async function solvedTilesFor(result,size){
  try{return await referenceSolvedTiles(result,size)||colourSolvedTiles(size);}catch(error){console.warn("Could not build solved preview",error);return colourSolvedTiles(size);}
}

async function toggleSolvedPreview(){
  if(state.busy||!state.variants.length)return;
  state.busy=true;renderControls();
  try{
    if(state.preview){
      state.preview=false;window.__lastTileCanvases=state.originalTiles;dispatchVariant(state.variants[state.index]);return;
    }
    const result=state.variants[state.index],size=Number(document.querySelector("#cube-size")?.value||3),tiles=await solvedTilesFor(result,size);
    if(!tiles){
      const detail=document.querySelector("#move-detail");if(detail)detail.textContent="A direct solved preview is unavailable for this cube, but the move sequence is still valid.";return;
    }
    state.preview=true;window.__lastTileCanvases=tiles;
    dispatchVariant({...result,moves:[],move_count:0,cubie_move_count:0,centre_move_count:0,__solvedPreview:true});
    queueMicrotask(()=>{
      const summary=document.querySelector("#result-summary");if(summary)summary.textContent=`Solved cube preview${state.variants.length>1?` · solution ${state.index+1}/${state.variants.length}`:""}`;
      const detail=document.querySelector("#move-detail");if(detail)detail.textContent="This is the final cube immediately, without playing the move animation.";
    });
  }finally{state.busy=false;queueMicrotask(renderControls);}
}
