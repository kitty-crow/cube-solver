const solveButton=document.querySelector("#solve-cube");
const workerStatus=document.querySelector("#worker-status");
const MODE_SETTING="picture-cube-mode";

function solidColourMode(){
  return window.pictureCubeMode?.isSolidColour?.()||localStorage.getItem(MODE_SETTING)==="solid-colour";
}

function assistantCandidate(){
  const assistant=window.pictureReference;
  const candidate=assistant?.result?.candidates?.[assistant?.selectedIndex];
  return{assistant,candidate};
}

function needsStickerIdentification(){
  if(solidColourMode())return false;
  const{assistant,candidate}=assistantCandidate();
  return Boolean(
    assistant&&
    Number(assistant.lastPayload?.size)===3&&
    candidate?.usable&&
    Array.isArray(candidate.facePreviews)&&candidate.facePreviews.length===6&&
    !assistant.identificationResolved?.()
  );
}

function syncLabel(){
  if(!solveButton)return;
  if(solidColourMode()){
    const text=String(solveButton.textContent||"").trim();
    if(text==="Solve by colours"||/^(Starting|Preparing|Solving)/.test(text))return;
    solveButton.textContent="Solve by colours";
    return;
  }
  if(!needsStickerIdentification())return;
  if(solveButton.textContent!=="Identify stickers")solveButton.textContent="Identify stickers";
  if(solveButton.disabled)solveButton.disabled=false;
}

solveButton?.addEventListener("click",event=>{
  if(solidColourMode()||!needsStickerIdentification())return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const{assistant}=assistantCandidate();
  solveButton.textContent="Identify stickers";
  Promise.resolve(assistant.openStickerIdentification()).catch(error=>{
    console.warn("Could not open sticker identification",error);
    if(workerStatus)workerStatus.textContent=error instanceof Error?error.message:String(error);
  });
},true);

if(solveButton){
  new MutationObserver(syncLabel).observe(solveButton,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:["disabled"]});
}
window.addEventListener("picture-reference-ready",syncLabel);
window.addEventListener("picture-cube-mode-changed",syncLabel);
window.addEventListener("picture-stickers-resolved",()=>{
  if(solveButton&&!solidColourMode())solveButton.textContent="Solve identified cube";
});
setTimeout(syncLabel,400);
