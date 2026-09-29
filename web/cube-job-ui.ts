import { downloadCurrentCubeJob, loadCubeJob } from "./cube-job.js";

const downloadButton=document.querySelector("#download-work");
const loadButton=document.querySelector("#load-work");
const fileInput=document.querySelector("#load-work-file");
const workerStatus=document.querySelector("#worker-status");

function setStatus(text){if(workerStatus)workerStatus.textContent=text;}
function setBusy(busy){if(downloadButton)downloadButton.disabled=busy;if(loadButton)loadButton.disabled=busy;}

async function flushCurrentEditors(){
  const assistant=window.pictureReference;
  if(!assistant)return;
  const aligner=assistant.aligner;
  if(aligner&&!aligner.root?.hidden&&typeof aligner.persistedDraft==="function"){
    const draft=aligner.persistedDraft();
    assistant.restoredDraft=draft?structuredClone(draft):null;
    await assistant.persistSessionOnly?.(assistant.restoredDraft);
  }
  const identifier=assistant.identifier;
  if(identifier&&!identifier.root?.hidden&&typeof identifier.serialise==="function"){
    const state=identifier.serialise();
    assistant.identificationState=state?structuredClone(state):null;
    await assistant.persistIdentificationState?.(assistant.identificationState);
  }else{
    await assistant.persistSelected?.();
  }
}

if(downloadButton){
  downloadButton.addEventListener("click",async()=>{
    setBusy(true);setStatus("Packing current work…");
    try{
      await flushCurrentEditors();
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
