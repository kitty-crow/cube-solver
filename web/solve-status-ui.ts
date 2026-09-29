const workerStatus=document.querySelector("#worker-status");
const solveProgressLabel=document.querySelector("#solve-progress-label");

function separateSearchPassStage(){
  if(!workerStatus||!solveProgressLabel)return;
  const text=String(solveProgressLabel.textContent||"").trim();
  const match=text.match(/^(Search pass\s+\d+\/\d+)\s*·\s*(.+)$/i);
  if(!match)return;
  // The pill owns the stage. The progress card owns only the changing sub-step.
  workerStatus.textContent=match[1];
  solveProgressLabel.textContent=match[2];
}

if(workerStatus&&solveProgressLabel){
  const observer=new MutationObserver(separateSearchPassStage);
  observer.observe(solveProgressLabel,{childList:true,characterData:true,subtree:true});
  separateSearchPassStage();
}
