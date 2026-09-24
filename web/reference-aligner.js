const FACE_NAMES=["U","R","F","D","L","B"];
const FACE_LABELS={U:"Top",R:"Right",F:"Front",D:"Bottom",L:"Left",B:"Back"};
const DEG=Math.PI/180;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function wrap(a){const p=Math.PI*2;return((a%p)+p)%p;}
function cloneOrientation(value){return{yaw:Number(value?.yaw||0),pitch:Number(value?.pitch||0),roll:Number(value?.roll||0)};}
function emptyWarp(){return{points:Array.from({length:9},()=>[0,0])};}
function cloneWarp(value){
  const points=Array.isArray(value?.points)?value.points:[];
  return{points:Array.from({length:9},(_,i)=>{
    const p=points[i]||[0,0];
    return[Number(p[0])||0,Number(p[1])||0];
  })};
}
function cloneWarps(value){return Object.fromEntries(FACE_NAMES.map(face=>[face,cloneWarp(value?.[face])]));}
function decodeBase64(encoded){
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function radToDeg(v){return Number(v||0)*180/Math.PI;}
function pct(v,digits=1){return`${(Number(v||0)*100).toFixed(digits)}%`;}
function fmtDeg(v){const n=radToDeg(v);return`${n>=0?"+":""}${n.toFixed(1)}°`;}

function installStyles(){
  if(document.querySelector("#reference-aligner-styles"))return;
  const style=document.createElement("style");
  style.id="reference-aligner-styles";
  style.textContent=`
    .reference-aligner { position:fixed; inset:0; z-index:10000; display:grid; grid-template-rows:auto minmax(0,1fr) auto; background:var(--pages-bg,#10131b); color:inherit; }
    .reference-aligner[hidden] { display:none; }
    .reference-aligner__head,.reference-aligner__foot { display:flex; gap:.65rem; align-items:center; padding:.75rem max(.8rem,env(safe-area-inset-right)) .75rem max(.8rem,env(safe-area-inset-left)); border-color:var(--app-border); background:color-mix(in srgb,var(--pages-bg,#10131b) 94%,transparent); }
    .reference-aligner__head { border-bottom:1px solid var(--app-border); }
    .reference-aligner__foot { border-top:1px solid var(--app-border); padding-bottom:max(.75rem,env(safe-area-inset-bottom)); }
    .reference-aligner__head h2 { margin:0; font-size:1rem; flex:1; }
    .reference-aligner__body { min-height:0; overflow:auto; overscroll-behavior:contain; padding:.8rem; display:grid; grid-template-columns:minmax(0,1.4fr) minmax(17rem,.75fr); gap:.9rem; }
    .reference-aligner__stage,.reference-aligner__side { min-width:0; display:grid; align-content:start; gap:.7rem; }
    .reference-aligner__panel { border:1px solid var(--app-border); border-radius:.8rem; padding:.65rem; background:color-mix(in srgb,var(--pages-bg,#10131b) 96%,white 4%); }
    .reference-aligner__toolbar { display:flex; flex-wrap:wrap; gap:.45rem; align-items:center; }
    .reference-aligner__toolbar .pages-button[aria-pressed="true"],.reference-aligner__face-button[aria-pressed="true"] { outline:2px solid var(--pages-accent); outline-offset:1px; }
    .reference-aligner__canvas { display:block; width:min(100%,44rem); aspect-ratio:1; margin:auto; border:1px solid var(--app-border); border-radius:.6rem; touch-action:none; background:#090b10; }
    .reference-aligner__net { display:block; width:100%; max-width:34rem; aspect-ratio:4/3; margin:auto; border:1px solid var(--app-border); border-radius:.55rem; touch-action:manipulation; background:#090b10; }
    .reference-aligner__faces { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:.35rem; }
    .reference-aligner__face-button { min-width:0; padding:.5rem .25rem; border:1px solid var(--app-border); border-radius:.55rem; background:transparent; color:inherit; font:inherit; cursor:pointer; }
    .reference-aligner__range { display:grid; grid-template-columns:auto minmax(7rem,1fr) auto; gap:.5rem; align-items:center; font-size:.76rem; }
    .reference-aligner__range input { width:100%; }
    .reference-aligner__readout { font-variant-numeric:tabular-nums; font-size:.72rem; opacity:.76; }
    .reference-aligner__hint { margin:0; font-size:.73rem; opacity:.72; line-height:1.4; }
    .reference-aligner__status { margin:0; font-size:.72rem; opacity:.75; }
    .reference-aligner__diagnostics { overflow:auto; }
    .reference-aligner__diagnostics table { width:100%; border-collapse:collapse; font-size:.68rem; font-variant-numeric:tabular-nums; }
    .reference-aligner__diagnostics th,.reference-aligner__diagnostics td { padding:.32rem .28rem; border-bottom:1px solid var(--app-border); text-align:right; white-space:nowrap; }
    .reference-aligner__diagnostics th:first-child,.reference-aligner__diagnostics td:first-child { text-align:left; }
    .reference-aligner__metric { display:grid; grid-template-columns:1fr auto auto; gap:.45rem; font-size:.7rem; padding:.22rem 0; }
    .reference-aligner__metric strong { font-variant-numeric:tabular-nums; }
    .reference-aligner__spacer { flex:1; }
    .reference-aligner__danger { opacity:.8; }
    body.reference-aligner-open { overflow:hidden; }
    @media (max-width:820px) {
      .reference-aligner__body { grid-template-columns:1fr; }
      .reference-aligner__side { grid-template-columns:1fr; }
      .reference-aligner__canvas { width:100%; max-height:58vh; }
    }
    @media (max-width:520px) {
      .reference-aligner__head,.reference-aligner__foot { flex-wrap:wrap; }
      .reference-aligner__faces { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .reference-aligner__foot .pages-button { flex:1; }
    }
  `;
  document.head.appendChild(style);
}

function buildScanFaces(payload){
  const size=Number(payload.size||3),tileSize=Number(payload.tile_size||48),raw=decodeBase64(payload.rgb_b64),area=size*size,faces=[];
  for(let face=0;face<6;face++){
    const canvas=document.createElement("canvas");
    canvas.width=size*tileSize;canvas.height=size*tileSize;
    const ctx=canvas.getContext("2d",{alpha:false});
    for(let local=0;local<area;local++){
      const tile=face*area+local,row=Math.floor(local/size),col=local%size,image=ctx.createImageData(tileSize,tileSize);
      const base=tile*tileSize*tileSize*3;
      for(let p=0;p<tileSize*tileSize;p++){
        image.data[p*4]=raw[base+p*3];
        image.data[p*4+1]=raw[base+p*3+1];
        image.data[p*4+2]=raw[base+p*3+2];
        image.data[p*4+3]=255;
      }
      ctx.putImageData(image,col*tileSize,row*tileSize);
    }
    faces.push(canvas);
  }
  return faces;
}
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("Could not render adjusted reference preview"));
    image.src=src;
  });
}
async function loadImages(urls){return Promise.all((urls||[]).map(loadImage));}

export class ReferenceAlignmentModal{
  constructor({onCommit,onStatus}={}){
    installStyles();
    this.onCommit=onCommit||(()=>{});
    this.onStatus=onStatus||(()=>{});
    this.root=this.makeRoot();
    this.worker=null;
    this.sessionId="";
    this.requestId=0;
    this.latestPreviewId=0;
    this.previewTimer=null;
    this.pendingCommitAction="";
    this.previewImages=[];
    this.scanFaces=[];
    this.candidate=null;
    this.payload=null;
    this.faceIndex=2;
    this.mode="global";
    this.opacity=.52;
    this.orientation={yaw:0,pitch:0,roll:0};
    this.autoOrientation={yaw:0,pitch:0,roll:0};
    this.faceWarps=cloneWarps();
    this.currentAlignment=null;
    this.currentDiagnostics=null;
    this.drag=null;
  }

  makeRoot(){
    const root=document.createElement("section");
    root.className="reference-aligner";
    root.hidden=true;
    root.setAttribute("role","dialog");
    root.setAttribute("aria-modal","true");
    root.setAttribute("aria-label","Adjust reference projection");
    root.innerHTML=`
      <header class="reference-aligner__head">
        <button class="pages-button" type="button" data-align-close aria-label="Close reference adjustment">Close</button>
        <h2>Adjust wrapped reference</h2>
        <p class="reference-aligner__status" data-align-status>Preparing overlay…</p>
      </header>
      <div class="reference-aligner__body">
        <main class="reference-aligner__stage">
          <div class="reference-aligner__panel">
            <div class="reference-aligner__toolbar">
              <button class="pages-button" type="button" data-align-mode="global" aria-pressed="true">Rotate globe</button>
              <button class="pages-button" type="button" data-align-mode="face" aria-pressed="false">Warp face</button>
              <span class="reference-aligner__spacer"></span>
              <button class="pages-button" type="button" data-align-roll="-5">Roll −5°</button>
              <button class="pages-button" type="button" data-align-roll="5">Roll +5°</button>
            </div>
            <p class="reference-aligner__hint" data-align-hint>Drag the overlay to rotate the reference around the cube. The photograph stays fixed underneath.</p>
          </div>
          <canvas class="reference-aligner__canvas" data-align-canvas width="720" height="720"></canvas>
          <div class="reference-aligner__faces" data-align-faces></div>
          <div class="reference-aligner__panel">
            <div class="reference-aligner__range">
              <span>Overlay</span>
              <input data-align-opacity type="range" min="0" max="1" step="0.01" value="0.52" aria-label="Reference overlay opacity">
              <span data-align-opacity-value>52%</span>
            </div>
            <div class="reference-aligner__toolbar" style="margin-top:.55rem">
              <button class="pages-button" type="button" data-align-reset-face>Reset this face</button>
              <button class="pages-button" type="button" data-align-reset-all>Reset to automatic</button>
            </div>
            <p class="reference-aligner__readout" data-align-readout></p>
          </div>
        </main>
        <aside class="reference-aligner__side">
          <div class="reference-aligner__panel">
            <strong>Wrapped cube preview</strong>
            <p class="reference-aligner__hint">All six faces update together. Tap a face to edit it.</p>
            <canvas class="reference-aligner__net" data-align-net width="800" height="600"></canvas>
          </div>
          <div class="reference-aligner__panel reference-aligner__diagnostics" data-align-diagnostics>
            <strong>Automatic vs corrected</strong>
            <p class="reference-aligner__hint">Diagnostics update as you move the projection.</p>
          </div>
        </aside>
      </div>
      <footer class="reference-aligner__foot">
        <button class="pages-button" type="button" data-align-export>Export debug JSON</button>
        <span class="reference-aligner__spacer"></span>
        <button class="pages-button" type="button" data-align-accept>This is better</button>
      </footer>
    `;
    document.body.appendChild(root);
    this.canvas=root.querySelector("[data-align-canvas]");
    this.net=root.querySelector("[data-align-net]");
    this.statusEl=root.querySelector("[data-align-status]");
    this.hintEl=root.querySelector("[data-align-hint]");
    this.readoutEl=root.querySelector("[data-align-readout]");
    this.diagnosticsEl=root.querySelector("[data-align-diagnostics]");
    this.opacityInput=root.querySelector("[data-align-opacity]");
    this.opacityValue=root.querySelector("[data-align-opacity-value]");
    this.acceptButton=root.querySelector("[data-align-accept]");
    this.exportButton=root.querySelector("[data-align-export]");

    root.querySelector("[data-align-close]").addEventListener("click",()=>this.close());
    root.querySelector("[data-align-reset-face]").addEventListener("click",()=>this.resetFace());
    root.querySelector("[data-align-reset-all]").addEventListener("click",()=>this.resetAll());
    this.acceptButton.addEventListener("click",()=>this.requestCommit("apply"));
    this.exportButton.addEventListener("click",()=>this.requestCommit("export"));
    this.opacityInput.addEventListener("input",()=>{
      this.opacity=Number(this.opacityInput.value);
      this.opacityValue.textContent=`${Math.round(this.opacity*100)}%`;
      this.draw();
    });
    for(const button of root.querySelectorAll("[data-align-mode]")){
      button.addEventListener("click",()=>this.setMode(button.dataset.alignMode));
    }
    for(const button of root.querySelectorAll("[data-align-roll]")){
      button.addEventListener("click",()=>{
        this.orientation.roll=wrap(this.orientation.roll+Number(button.dataset.alignRoll)*DEG);
        this.changed();
      });
    }
    this.canvas.addEventListener("pointerdown",event=>this.pointerDown(event));
    this.canvas.addEventListener("pointermove",event=>this.pointerMove(event));
    this.canvas.addEventListener("pointerup",event=>this.pointerUp(event));
    this.canvas.addEventListener("pointercancel",event=>this.pointerUp(event));
    this.net.addEventListener("click",event=>this.selectNetFace(event));

    const faces=root.querySelector("[data-align-faces]");
    for(const face of FACE_NAMES){
      const button=document.createElement("button");
      button.type="button";
      button.className="reference-aligner__face-button";
      button.dataset.alignFace=face;
      button.textContent=`${FACE_LABELS[face]} · ${face}`;
      button.addEventListener("click",()=>this.setFace(FACE_NAMES.indexOf(face)));
      faces.appendChild(button);
    }
    return root;
  }

  ensureWorker(){
    this.worker?.terminate?.();
    this.worker=new Worker(new URL("./reference-v6-worker.js",import.meta.url),{type:"module"});
    this.worker.addEventListener("message",event=>this.workerMessage(event.data||{}));
    this.worker.addEventListener("error",event=>this.showError(event.message||"Reference adjustment worker failed"));
  }

  async open({candidate,payload}){
    if(!candidate?.projection?.editable||candidate.projection.kind!=="equirectangular")throw new Error("Only spherical references can be manually wrapped");
    if(!payload?.rgb_b64)throw new Error("The saved cube scan is unavailable");
    this.candidate=candidate;
    this.payload=payload;
    this.scanFaces=buildScanFaces(payload);
    this.orientation=cloneOrientation(candidate.projection.orientation);
    this.autoOrientation=cloneOrientation(candidate.projection.automaticOrientation||candidate.automaticBaseline?.orientation||candidate.projection.orientation);
    this.faceWarps=cloneWarps(candidate.projection.faceWarps);
    this.currentAlignment=candidate.alignment||null;
    this.currentDiagnostics=candidate.manualDiagnostics||null;
    const weakest=(candidate.alignment?.anchors||[]).reduce((best,item)=>!best||Number(item.margin||0)<Number(best.margin||0)?item:best,null);
    this.faceIndex=Math.max(0,FACE_NAMES.indexOf(weakest?.target||"F"));
    this.mode="global";
    this.opacity=.52;
    this.opacityInput.value=String(this.opacity);
    this.opacityValue.textContent="52%";
    this.previewImages=await loadImages(candidate.facePreviews||[]);
    this.root.hidden=false;
    document.body.classList.add("reference-aligner-open");
    this.setMode("global");
    this.setFace(this.faceIndex);
    this.statusEl.textContent="Loading spherical reference…";
    this.draw();
    this.renderDiagnostics();

    this.sessionId=`align-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.requestId=0;this.latestPreviewId=0;this.pendingCommitAction="";
    this.ensureWorker();
    const raw=decodeBase64(payload.rgb_b64);
    this.worker.postMessage({
      type:"adjust-start",sessionId:this.sessionId,rawBuffer:raw.buffer,tileSize:Number(payload.tile_size),size:Number(payload.size),candidate,
    },[raw.buffer]);
  }

  close(){
    clearTimeout(this.previewTimer);
    this.previewTimer=null;
    if(this.worker){
      try{this.worker.postMessage({type:"adjust-end",sessionId:this.sessionId});}catch(_){}
      this.worker.terminate();
      this.worker=null;
    }
    this.root.hidden=true;
    document.body.classList.remove("reference-aligner-open");
    this.drag=null;
    this.pendingCommitAction="";
  }

  async workerMessage(msg){
    if(msg.sessionId&&msg.sessionId!==this.sessionId)return;
    if(msg.type==="reference-adjust-ready"){
      this.statusEl.textContent="Automatic alignment loaded";
      this.schedulePreview(0);
      return;
    }
    if(msg.type==="reference-adjust-preview"){
      if(Number(msg.requestId||0)<this.latestPreviewId)return;
      this.latestPreviewId=Number(msg.requestId||0);
      try{this.previewImages=await loadImages(msg.facePreviews||[]);}catch(error){this.showError(error.message);return;}
      this.currentAlignment=msg.alignment||this.currentAlignment;
      this.currentDiagnostics=msg.diagnostics||null;
      this.statusEl.textContent="Overlay updated";
      this.draw();this.renderDiagnostics();
      return;
    }
    if(msg.type==="reference-adjust-commit"){
      const action=this.pendingCommitAction;
      this.pendingCommitAction="";
      this.acceptButton.disabled=false;this.exportButton.disabled=false;
      if(!msg.candidate)return this.showError("Adjusted reference did not produce evidence");
      if(action==="export"){
        this.downloadDiagnostics(msg.candidate);
        this.statusEl.textContent="Debug JSON exported";
        return;
      }
      if(action==="apply"){
        await this.onCommit(msg.candidate);
        this.close();
      }
      return;
    }
    if(msg.type==="reference-adjust-error"){
      this.pendingCommitAction="";
      this.acceptButton.disabled=false;this.exportButton.disabled=false;
      this.showError(msg.message||"Reference adjustment failed");
    }
  }

  setMode(mode){
    this.mode=mode==="face"?"face":"global";
    for(const button of this.root.querySelectorAll("[data-align-mode]"))button.setAttribute("aria-pressed",String(button.dataset.alignMode===this.mode));
    this.hintEl.textContent=this.mode==="global"
      ?"Drag the translucent artwork to rotate the spherical reference around the fixed cube scan. Use Roll for the third axis."
      :"Drag a mesh handle to bend this face locally. Drag between handles to move the whole face warp. The automatic spherical rotation remains underneath.";
    this.draw();
  }

  setFace(index){
    this.faceIndex=clamp(Number(index)||0,0,5);
    for(const button of this.root.querySelectorAll("[data-align-face]"))button.setAttribute("aria-pressed",String(button.dataset.alignFace===FACE_NAMES[this.faceIndex]));
    this.draw();this.renderDiagnostics();
  }

  resetFace(){
    this.faceWarps[FACE_NAMES[this.faceIndex]]=emptyWarp();
    this.changed();
  }

  resetAll(){
    this.orientation=cloneOrientation(this.autoOrientation);
    this.faceWarps=cloneWarps();
    this.changed();
  }

  changed(){
    this.updateReadout();
    this.draw();
    this.schedulePreview();
  }

  schedulePreview(delay=85){
    clearTimeout(this.previewTimer);
    this.previewTimer=setTimeout(()=>{
      if(!this.worker)return;
      const requestId=++this.requestId;
      this.statusEl.textContent="Updating overlay…";
      this.worker.postMessage({
        type:"adjust-preview",sessionId:this.sessionId,requestId,
        adjustment:{orientation:this.orientation,faceWarps:this.faceWarps},
      });
    },delay);
  }

  requestCommit(action){
    if(!this.worker||this.pendingCommitAction)return;
    this.pendingCommitAction=action;
    this.acceptButton.disabled=true;this.exportButton.disabled=true;
    const requestId=++this.requestId;
    this.statusEl.textContent=action==="apply"?"Rebuilding solver evidence…":"Building debug report…";
    this.worker.postMessage({
      type:"adjust-commit",sessionId:this.sessionId,requestId,
      adjustment:{orientation:this.orientation,faceWarps:this.faceWarps},
    });
  }

  pointerPosition(event){
    const rect=this.canvas.getBoundingClientRect();
    return{x:(event.clientX-rect.left)*this.canvas.width/rect.width,y:(event.clientY-rect.top)*this.canvas.height/rect.height};
  }

  pointerDown(event){
    const p=this.pointerPosition(event);
    this.canvas.setPointerCapture?.(event.pointerId);
    if(this.mode==="global"){
      this.drag={kind:"global",pointerId:event.pointerId,start:p,orientation:cloneOrientation(this.orientation)};
      return;
    }
    const face=FACE_NAMES[this.faceIndex],warp=this.faceWarps[face]||emptyWarp(),w=this.canvas.width,h=this.canvas.height;
    let nearest=-1,nearestDistance=Infinity;
    for(let i=0;i<9;i++){
      const col=i%3,row=Math.floor(i/3),point=warp.points[i],hx=(col/2+point[0])*w,hy=(row/2+point[1])*h,d=Math.hypot(p.x-hx,p.y-hy);
      if(d<nearestDistance){nearestDistance=d;nearest=i;}
    }
    const points=warp.points.map(point=>[point[0],point[1]]);
    this.drag={kind:nearestDistance<42?"handle":"face",pointerId:event.pointerId,start:p,handle:nearest,points};
  }

  pointerMove(event){
    if(!this.drag||this.drag.pointerId!==event.pointerId)return;
    const p=this.pointerPosition(event),dx=p.x-this.drag.start.x,dy=p.y-this.drag.start.y;
    if(this.drag.kind==="global"){
      const sensitivity=.20*DEG;
      this.orientation.yaw=wrap(this.drag.orientation.yaw+dx*sensitivity);
      this.orientation.pitch=clamp(this.drag.orientation.pitch-dy*sensitivity,-Math.PI/2,Math.PI/2);
      this.changed();
      return;
    }
    const face=FACE_NAMES[this.faceIndex],warp=this.faceWarps[face]||emptyWarp(),nx=dx/this.canvas.width,ny=dy/this.canvas.height;
    if(this.drag.kind==="handle"){
      const i=this.drag.handle,base=this.drag.points[i];
      warp.points[i]=[clamp(base[0]+nx,-.42,.42),clamp(base[1]+ny,-.42,.42)];
    }else{
      warp.points=this.drag.points.map(point=>[clamp(point[0]+nx,-.42,.42),clamp(point[1]+ny,-.42,.42)]);
    }
    this.faceWarps[face]=warp;
    this.changed();
  }

  pointerUp(event){
    if(!this.drag||this.drag.pointerId!==event.pointerId)return;
    this.drag=null;
    this.schedulePreview(20);
  }

  selectNetFace(event){
    const rect=this.net.getBoundingClientRect(),x=(event.clientX-rect.left)*4/rect.width,y=(event.clientY-rect.top)*3/rect.height,col=Math.floor(x),row=Math.floor(y);
    const positions={"1,0":"U","0,1":"L","1,1":"F","2,1":"R","3,1":"B","1,2":"D"},face=positions[`${col},${row}`];
    if(face)this.setFace(FACE_NAMES.indexOf(face));
  }

  draw(){
    if(!this.scanFaces.length)return;
    this.drawFace();
    this.drawNet();
    this.updateReadout();
  }

  drawFace(){
    const ctx=this.canvas.getContext("2d"),w=this.canvas.width,h=this.canvas.height,face=FACE_NAMES[this.faceIndex];
    ctx.clearRect(0,0,w,h);
    ctx.drawImage(this.scanFaces[this.faceIndex],0,0,w,h);
    if(this.previewImages[this.faceIndex]){
      ctx.save();ctx.globalAlpha=this.opacity;ctx.drawImage(this.previewImages[this.faceIndex],0,0,w,h);ctx.restore();
    }
    const size=Number(this.payload?.size||3);
    ctx.save();ctx.lineWidth=2;ctx.strokeStyle="rgba(255,255,255,.34)";
    for(let i=1;i<size;i++){const q=i*w/size;ctx.beginPath();ctx.moveTo(q,0);ctx.lineTo(q,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,q);ctx.lineTo(w,q);ctx.stroke();}
    ctx.restore();
    if(this.mode==="face"){
      const warp=this.faceWarps[face]||emptyWarp(),pts=warp.points.map((point,i)=>({x:((i%3)/2+point[0])*w,y:(Math.floor(i/3)/2+point[1])*h}));
      ctx.save();ctx.lineWidth=3;ctx.strokeStyle="rgba(255,255,255,.72)";ctx.fillStyle="rgba(20,20,28,.85)";
      for(let row=0;row<3;row++)for(let col=0;col<2;col++){const a=pts[row*3+col],b=pts[row*3+col+1];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      for(let col=0;col<3;col++)for(let row=0;row<2;row++){const a=pts[row*3+col],b=pts[(row+1)*3+col];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      for(const p of pts){ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.fill();ctx.stroke();}
      ctx.restore();
    }
    ctx.save();ctx.font="700 28px system-ui";ctx.textAlign="left";ctx.textBaseline="top";ctx.fillStyle="rgba(0,0,0,.7)";ctx.fillText(face,17,17);ctx.fillStyle="white";ctx.fillText(face,14,14);ctx.restore();
  }

  drawNet(){
    const ctx=this.net.getContext("2d"),w=this.net.width,h=this.net.height,cw=w/4,ch=h/3,positions={U:[1,0],L:[0,1],F:[1,1],R:[2,1],B:[3,1],D:[1,2]};
    ctx.clearRect(0,0,w,h);
    for(const[face,[col,row]]of Object.entries(positions)){
      const i=FACE_NAMES.indexOf(face),x=col*cw,y=row*ch;
      ctx.drawImage(this.scanFaces[i],x,y,cw,ch);
      if(this.previewImages[i]){ctx.save();ctx.globalAlpha=this.opacity;ctx.drawImage(this.previewImages[i],x,y,cw,ch);ctx.restore();}
      ctx.save();ctx.lineWidth=face===FACE_NAMES[this.faceIndex]?6:2;ctx.strokeStyle=face===FACE_NAMES[this.faceIndex]?"rgba(255,255,255,.95)":"rgba(255,255,255,.35)";ctx.strokeRect(x+2,y+2,cw-4,ch-4);
      ctx.font="700 22px system-ui";ctx.fillStyle="white";ctx.fillText(face,x+9,y+27);ctx.restore();
    }
  }

  updateReadout(){
    const face=FACE_NAMES[this.faceIndex],warp=this.faceWarps[face]||emptyWarp(),maxWarp=Math.max(...warp.points.map(p=>Math.hypot(p[0],p[1])));
    this.readoutEl.textContent=`${face} · yaw ${fmtDeg(this.orientation.yaw)} · pitch ${fmtDeg(this.orientation.pitch)} · roll ${fmtDeg(this.orientation.roll)} · local warp ${(maxWarp*100).toFixed(1)}%`;
  }

  renderDiagnostics(){
    const d=this.currentDiagnostics,auto=this.candidate?.automaticBaseline;
    if(!d){
      const alignment=this.currentAlignment||this.candidate?.alignment;
      this.diagnosticsEl.innerHTML=`
        <strong>Automatic vs corrected</strong>
        <div class="reference-aligner__metric"><span>Automatic centre similarity</span><strong>${pct(auto?.alignment?.mean??alignment?.mean)}</strong><span></span></div>
        <div class="reference-aligner__metric"><span>Automatic centre margin</span><strong>${pct(auto?.alignment?.margin??alignment?.margin)}</strong><span></span></div>
        <p class="reference-aligner__hint">Move the projection to generate a live comparison.</p>`;
      return;
    }
    const faceRows=(d.faces||[]).map(row=>`<tr><td>${row.face}</td><td>${pct(row.automatic?.score)}</td><td>${pct(row.automatic?.margin)}</td><td>${pct(row.corrected?.score)}</td><td>${pct(row.corrected?.margin)}</td></tr>`).join("");
    this.diagnosticsEl.innerHTML=`
      <strong>Automatic vs corrected</strong>
      <div class="reference-aligner__metric"><span>Orientation correction</span><strong>${Number(d.angularErrorDeg||0).toFixed(1)}°</strong><span></span></div>
      <div class="reference-aligner__metric"><span>Mean centre similarity</span><strong>${pct(d.automatic?.centreMean)}</strong><strong>→ ${pct(d.corrected?.centreMean)}</strong></div>
      <div class="reference-aligner__metric"><span>Mean uniqueness margin</span><strong>${pct(d.automatic?.centreMargin)}</strong><strong>→ ${pct(d.corrected?.centreMargin)}</strong></div>
      <table>
        <thead><tr><th>Face</th><th>Auto sim.</th><th>Auto margin</th><th>Corrected sim.</th><th>Corrected margin</th></tr></thead>
        <tbody>${faceRows}</tbody>
      </table>
      <p class="reference-aligner__hint">A high raw similarity with a tiny margin is ambiguous. The corrected margin shows whether your manual alignment made the face more distinctive.</p>`;
  }

  downloadDiagnostics(candidate){
    const report={
      schema:"picture-cube-reference-alignment-debug-v1",
      createdAt:new Date().toISOString(),
      reference:{
        title:candidate.title||"",
        sourceUrl:candidate.sourceUrl||"",
        thumbnailUrl:candidate.thumbnailUrl||"",
        layout:candidate.layout||"",
      },
      automatic:candidate.automaticBaseline||null,
      corrected:{
        projection:candidate.projection||null,
        alignment:candidate.alignment||null,
        fit:Number(candidate.fit||0),
        rawFit:Number(candidate.rawFit||0),
        distinctiveness:Number(candidate.distinctiveness||0),
      },
      diagnostics:candidate.manualDiagnostics||null,
      scan:{
        size:Number(this.payload?.size||0),
        tileSize:Number(this.payload?.tile_size||0),
        roundedCubies:Boolean(this.payload?.rounded_cubies),
      },
    };
    const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`reference-alignment-${Date.now()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  showError(message){
    this.statusEl.textContent=String(message||"Reference adjustment failed");
    this.onStatus(this.statusEl.textContent);
  }
}
