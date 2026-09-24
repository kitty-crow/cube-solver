const solveButton=document.querySelector("#solve-cube");
const workerStatus=document.querySelector("#worker-status");

function assistantCandidate(){
  const assistant=window.pictureReference;
  const candidate=assistant?.result?.candidates?.[assistant?.selectedIndex];
  return{assistant,candidate};
}

function needsStickerIdentification(){
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
  if(!solveButton||!needsStickerIdentification())return;
  solveButton.textContent="Identify stickers";
  solveButton.disabled=false;
}

solveButton?.addEventListener("click",event=>{
  if(!needsStickerIdentification())return;
  // This capture listener is deliberately independent of the semantic-search
  // listener. Once a usable solved wrap exists, the legacy fuzzy solver must
  // never be allowed to bypass the manual/constraint identification stage.
  event.preventDefault();
  event.stopImmediatePropagation();
  const{assistant}=assistantCandidate();
  solveButton.textContent="Identify stickers";
  Promise.resolve(assistant.openStickerIdentification()).catch(error=>{
    console.warn("Could not open sticker identification",error);
    if(workerStatus)workerStatus.textContent=error instanceof Error?error.message:String(error);
  });
},true);

window.addEventListener("picture-reference-ready",syncLabel);
window.addEventListener("picture-stickers-resolved",()=>{
  if(solveButton)solveButton.textContent="Solve identified cube";
});
setTimeout(syncLabel,400);
