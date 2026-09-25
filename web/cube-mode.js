const MODE_SETTING="picture-cube-mode";
const PICTURE_MODE="picture";
const SOLID_MODE="solid-colour";

const modeSelect=document.querySelector("#cube-mode");
const sizeSelect=document.querySelector("#cube-size");
const solveButton=document.querySelector("#solve-cube");
const workerStatus=document.querySelector("#worker-status");

function normaliseMode(value){return value===SOLID_MODE?SOLID_MODE:PICTURE_MODE;}
function currentSize(){return Number(sizeSelect?.value||3);}
function currentMode(){return normaliseMode(modeSelect?.value||localStorage.getItem(MODE_SETTING));}
function solidOption(){return modeSelect?.querySelector('option[value="solid-colour"]')||null;}

function syncAvailability(){
  const option=solidOption();
  if(option){
    option.disabled=currentSize()!==3;
    option.textContent=currentSize()===3?"Solid colour":"Solid colour (3×3 only)";
  }
  if(currentSize()!==3&&currentMode()===SOLID_MODE){
    modeSelect.value=PICTURE_MODE;
    localStorage.setItem(MODE_SETTING,PICTURE_MODE);
  }
}

function syncSolveLabel(){
  if(!solveButton||currentMode()!==SOLID_MODE)return;
  const text=String(solveButton.textContent||"").trim();
  if(/^(Solve\b|Identify stickers|Solve identified cube|Choose a reference|Find|Finding artwork)/i.test(text)&&text!=="Solving…"){
    solveButton.textContent="Solve by colours";
  }
}

function applyMode(announce=false){
  syncAvailability();
  const mode=currentMode();
  localStorage.setItem(MODE_SETTING,mode);
  document.documentElement.dataset.cubeMode=mode;
  if(announce&&workerStatus){
    workerStatus.textContent=mode===SOLID_MODE
      ?"Solid colour mode · exactly six colours"
      :"Picture mode · artwork matching enabled";
  }
  window.dispatchEvent(new CustomEvent("picture-cube-mode-changed",{detail:{mode}}));
  queueMicrotask(syncSolveLabel);
}

if(modeSelect){
  const stored=normaliseMode(localStorage.getItem(MODE_SETTING));
  modeSelect.value=stored;
  syncAvailability();
  modeSelect.addEventListener("change",()=>applyMode(true));
}
sizeSelect?.addEventListener("change",()=>applyMode(false));
if(solveButton){
  new MutationObserver(syncSolveLabel).observe(solveButton,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled"]});
}

window.pictureCubeMode={
  get current(){return currentMode();},
  isSolidColour(){return currentMode()===SOLID_MODE;},
};

applyMode(false);
