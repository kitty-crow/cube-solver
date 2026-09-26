const cameraStage=document.querySelector(".camera-stage");
const startButton=document.querySelector("#start-camera");
const stopButton=document.querySelector("#stop-camera");
const captureButton=document.querySelector("#capture-face");
const stabilityLabel=document.querySelector("#stability-label");
const scanCounter=document.querySelector("#scan-counter");
const scanTitle=document.querySelector("#scan-title");
const scanInstruction=document.querySelector("#scan-instruction");
const reviewGrid=document.querySelector("#review-grid");
const solveStage=document.querySelector("#solve-stage");
const solveButton=document.querySelector("#solve-cube");

function installPageChromeStyles(){
  if(document.querySelector("#main-ui-v2-styles"))return;
  const style=document.createElement("style");
  style.id="main-ui-v2-styles";
  style.textContent=`
    .pages-footer {
      display:flex !important;
      flex-direction:row !important;
      flex-wrap:nowrap !important;
      align-items:center !important;
      justify-content:space-between !important;
      gap:1rem !important;
    }
    .pages-footer > * { margin:0 !important; min-width:0; }
    .pages-footer [data-version] { white-space:nowrap; }
    .pages-footer a { white-space:nowrap; }
  `;
  document.head.appendChild(style);
}

let cameraVisible=true;
let autoStopped=false;
let internalStop=false;
let internalStart=false;
let lastCaptureAt=0;

function cameraRunning(){return Boolean(cameraStage?.classList.contains("camera-stage--live"));}

function pauseCameraForViewport(){
  if(!cameraRunning()||!stopButton)return;
  autoStopped=true;
  internalStop=true;
  stopButton.click();
  internalStop=false;
}

function resumeCameraForViewport(){
  if(!autoStopped||cameraRunning()||!startButton)return;
  autoStopped=false;
  internalStart=true;
  startButton.click();
  internalStart=false;
}

function syncCameraViewport(){
  if(!cameraStage)return;
  if(!cameraVisible)pauseCameraForViewport();
  else resumeCameraForViewport();
}

if(cameraStage&&"IntersectionObserver" in window){
  const observer=new IntersectionObserver(entries=>{
    const entry=entries[entries.length-1];
    cameraVisible=Boolean(entry?.isIntersecting);
    syncCameraViewport();
  },{threshold:0});
  observer.observe(cameraStage);

  // If getUserMedia finishes after the preview has already left the viewport,
  // IntersectionObserver may not emit another transition. Watch the live class
  // as well so an off-screen camera cannot remain running accidentally.
  new MutationObserver(()=>syncCameraViewport()).observe(cameraStage,{attributes:true,attributeFilter:["class"]});
}

stopButton?.addEventListener("click",()=>{
  if(!internalStop)autoStopped=false;
});
startButton?.addEventListener("click",()=>{
  if(!internalStart)autoStopped=false;
});

function captureFromPreview(event){
  if(!cameraRunning()||!captureButton||captureButton.disabled)return;
  if(event?.type==="keydown"&&!(["Enter"," "].includes(event.key)))return;
  if(event?.type==="keydown")event.preventDefault();
  const now=performance.now();
  if(now-lastCaptureAt<320)return;
  lastCaptureAt=now;
  captureButton.click();
}

if(cameraStage){
  cameraStage.tabIndex=0;
  cameraStage.setAttribute("role","button");
  cameraStage.setAttribute("aria-label","Camera preview. Tap or click to capture the current face.");
  cameraStage.addEventListener("click",captureFromPreview);
  cameraStage.addEventListener("keydown",captureFromPreview);
}
if(stabilityLabel)stabilityLabel.setAttribute("aria-label","Tap or click the preview to capture");

function scanComplete(){return Boolean(reviewGrid&&reviewGrid.querySelectorAll(".scan-card").length===6);}

function syncSolveStage(){
  if(solveStage)solveStage.hidden=!scanComplete();
}

function syncCompletionCopy(){
  if(!scanTitle||!scanInstruction)return;
  if(String(scanCounter?.textContent||"").trim()!=="6 / 6")return;
  if(scanTitle.textContent.trim()==="Ready to solve"){
    scanTitle.textContent="Capture complete";
    scanInstruction.textContent="Continue below to identify, map and solve the cube.";
  }
}

function canonicaliseSolveLabel(){
  if(!solveButton)return;
  const current=String(solveButton.textContent||"");
  const canonical=current
    .replace(/Solve\s+(\d+)×\1×\1/g,"Solve $1×$1")
    .replace(/Solve\s+(\d+)x\1x\1/gi,"Solve $1×$1");
  if(canonical!==current)solveButton.textContent=canonical;
}

if(reviewGrid)new MutationObserver(syncSolveStage).observe(reviewGrid,{childList:true,subtree:true});
if(scanCounter)new MutationObserver(syncCompletionCopy).observe(scanCounter,{childList:true,characterData:true,subtree:true});
if(scanTitle)new MutationObserver(syncCompletionCopy).observe(scanTitle,{childList:true,characterData:true,subtree:true});
if(solveButton)new MutationObserver(canonicaliseSolveLabel).observe(solveButton,{childList:true,characterData:true,subtree:true});
window.addEventListener("picture-main-solution",()=>document.querySelector("[data-tweak-reset]")?.click());

installPageChromeStyles();
syncSolveStage();
syncCompletionCopy();
canonicaliseSolveLabel();
