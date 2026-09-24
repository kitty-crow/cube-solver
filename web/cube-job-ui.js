import { downloadCurrentCubeJob, loadCubeJob } from "./cube-job.js";

const downloadButton=document.querySelector("#download-work");
const loadButton=document.querySelector("#load-work");
const fileInput=document.querySelector("#load-work-file");
const workerStatus=document.querySelector("#worker-status");

function setStatus(text){if(workerStatus)workerStatus.textContent=text;}
function setBusy(busy){if(downloadButton)downloadButton.disabled=busy;if(loadButton)loadButton.disabled=busy;}

if(downloadButton){
  downloadButton.addEventListener("click",async()=>{
    setBusy(true);setStatus("Packing current work…");
    try{
      await downloadCurrentCubeJob();
      setStatus("Work downloaded");
    }catch(error){
      console.error(error);setStatus(error instanceof Error?error.message:String(error));
    }finally{setBusy(false);}
  });
}

if(loadButton&&fileInput){
  loadButton.addEventListener("click",()=>fileInput.click());
  fileInput.addEventListener("change",async()=>{
    const file=fileInput.files?.[0];fileInput.value="";if(!file)return;
    setBusy(true);setStatus("Loading cube work…");
    try{
      await loadCubeJob(file);
      setStatus("Work restored · reloading…");
      location.reload();
    }catch(error){
      console.error(error);setStatus(error instanceof Error?error.message:String(error));setBusy(false);
    }
  });
}
