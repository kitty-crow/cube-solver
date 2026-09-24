const workerStatus=document.querySelector("#worker-status");
const solveProgressLabel=document.querySelector("#solve-progress-label");

function keepSearchPassPillConcise(){
  if(!workerStatus||!solveProgressLabel)return;
  const text=String(solveProgressLabel.textContent||"").trim();
  const match=text.match(/^(Search pass\s+\d+\/\d+)\s*·\s*(.+)$/i);
  if(!match)return;
  // The pill is the stage; the progress card carries the detailed sub-step.
  // Do not repeat "expanding mapping seed…" in both places.
  workerStatus.textContent=match[1];
}

if(workerStatus&&solveProgressLabel){
  const observer=new MutationObserver(keepSearchPassPillConcise);
  observer.observe(solveProgressLabel,{childList:true,characterData:true,subtree:true});
  keepSearchPassPillConcise();
}
