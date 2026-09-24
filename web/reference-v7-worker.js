import { FACE_NAMES, clamp, blankWarp, faceDirection, cloneOrientation } from "./cube-surface-map.js";

const inner=new Worker(new URL("./reference-v6-worker.js",self.location.href),{type:"module"});
let pendingMatch=null;
const imageCache=new Map();

function status(stage,detail,progress){postMessage({type:"reference-status",stage,detail,progress});}
function median(values){const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function bytesToBase64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}

async function imageDataFromUrl(url,maxSide=1024){
  const key=`${url}|${maxSide}`;if(imageCache.has(key))return imageCache.get(key);
  const promise=(async()=>{const response=await fetch(url);if(!response.ok)throw new Error(`Reference fetch ${response.status}`);const blob=await response.blob(),bitmap=await createImageBitmap(blob);try{const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale)),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);return ctx.getImageData(0,0,w,h);}finally{bitmap.close?.();}})();
  imageCache.set(key,promise);try{return await promise;}catch(error){imageCache.delete(key);throw error;}
}
function sampleImage(image,x,y){
  let ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const{data,width,height}=image;ix=((ix%width)+width)%width;iy=Math.max(0,Math.min(height-1,iy));
  const ix1=(ix+1)%width,iy1=Math.min(height-1,iy+1),out=[0,0,0];for(let c=0;c<3;c++){const a=data[(iy*width+ix)*4+c]*(1-fx)+data[(iy*width+ix1)*4+c]*fx,b=data[(iy1*width+ix)*4+c]*(1-fx)+data[(iy1*width+ix1)*4+c]*fx;out[c]=a*(1-fy)+b*fy;}return out;
}

function rawStatePixel(raw,tileSize,state,x,y){
  const tile=Math.floor(state/4),rot=state%4,n=tileSize;let ox=x,oy=y;
  if(rot===1){ox=y;oy=n-1-x;}else if(rot===2){ox=n-1-x;oy=n-1-y;}else if(rot===3){ox=n-1-y;oy=x;}
  const o=((tile*n*n)+oy*n+ox)*3;return[raw[o],raw[o+1],raw[o+2]];
}
function pixelStats([r,g,b]){const max=Math.max(r,g,b),min=Math.min(r,g,b);return{lum:(.2126*r+.7152*g+.0722*b)/255,sat:(max-min)/Math.max(1,max),max:max/255};}
function glareLikelihood(raw,tileSize,state,x,y){
  const s=pixelStats(rawStatePixel(raw,tileSize,state,x,y));if(s.lum<.70||s.sat>.30)return 0;
  const lums=[];for(const[dx,dy]of[[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,-1],[-1,1],[1,1]]){const nx=clamp(x+dx,0,tileSize-1),ny=clamp(y+dy,0,tileSize-1);lums.push(pixelStats(rawStatePixel(raw,tileSize,state,nx,ny)).lum);}
  const local=median(lums),spike=clamp((s.lum-local-.08)/.22),white=clamp((.28-s.sat)/.28),clip=clamp((s.max-.94)/.06);return clamp(Math.max(spike*white,clip*white*.85));
}
function statePixel(raw,tileSize,state,x,y){
  const rgb=rawStatePixel(raw,tileSize,state,x,y),glare=glareLikelihood(raw,tileSize,state,x,y);if(glare<=.02)return rgb;
  const neighbours=[[],[],[]];for(const[dx,dy]of[[-3,0],[3,0],[0,-3],[0,3],[-2,-2],[2,-2],[-2,2],[2,2]]){const nx=clamp(x+dx,0,tileSize-1),ny=clamp(y+dy,0,tileSize-1),p=rawStatePixel(raw,tileSize,state,nx,ny);if(glareLikelihood(raw,tileSize,state,nx,ny)>.35)continue;for(let c=0;c<3;c++)neighbours[c].push(p[c]);}
  if(!neighbours[0].length)return rgb;const repaired=neighbours.map(median),blend=.92*glare;return rgb.map((v,c)=>v*(1-blend)+repaired[c]*blend);
}
function estimateGlareFraction(raw,tileSize,tileCount){let glare=0,count=0,step=Math.max(2,Math.floor(tileSize/10));for(let tile=0;tile<tileCount;tile++)for(let y=step;y<tileSize-step;y+=step)for(let x=step;x<tileSize-step;x+=step){glare+=glareLikelihood(raw,tileSize,tile*4,x,y);count++;}return count?glare/count:0;}

function descriptorFromPixels(readPixel,x0,y0,x1,y1,side=8){
  const vals=new Float32Array(side*side*4);let mean=0,p=0;for(let y=0;y<side;y++)for(let x=0;x<side;x++){const sx=x0+(x+.5)*(x1-x0)/side,sy=y0+(y+.5)*(y1-y0)/side,[r,g,b]=readPixel(sx,sy),sum=r+g+b+1,lum=(.2126*r+.7152*g+.0722*b)/255;vals[p++]=r/sum;vals[p++]=g/sum;vals[p++]=b/sum;vals[p++]=lum;mean+=lum;}
  mean/=side*side;const out=[];for(let i=0;i<side*side;i++)out.push(vals[i*4]*.75,vals[i*4+1]*.75,vals[i*4+2]*.75,(vals[i*4+3]-mean)*.45);for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){const i=y*side+x;out.push((vals[(i+1)*4+3]-vals[(i-1)*4+3])*.75,(vals[(i+side)*4+3]-vals[(i-side)*4+3])*.75);}const n=Math.sqrt(out.reduce((s,v)=>s+v*v,0))||1;return Float32Array.from(out,v=>v/n);
}
const similarity=(a,b)=>{let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=a[i]*b[i];return clamp((s+1)/2);};
function scanDescriptors(raw,tileSize,tileCount){const out=new Array(tileCount*4);for(let state=0;state<out.length;state++)out[state]=descriptorFromPixels((x,y)=>statePixel(raw,tileSize,state,clamp(Math.floor(x),0,tileSize-1),clamp(Math.floor(y),0,tileSize-1)),0,0,tileSize,tileSize);return out;}
function imageDescriptor(image,x0,y0,x1,y1){return descriptorFromPixels((x,y)=>sampleImage(image,x,y),x0,y0,x1,y1);}
function referenceDescriptors(faceImages,size){const out=[];for(let face=0;face<6;face++){const img=faceImages[face];for(let row=0;row<size;row++)for(let col=0;col<size;col++)out.push(imageDescriptor(img,col*img.width/size,row*img.height/size,(col+1)*img.width/size,(row+1)*img.height/size));}return out;}

function projectCube(image,res,orientation){
  const faces=[],warp=blankWarp(),global=cloneOrientation(orientation);
  for(let face=0;face<6;face++){
    const canvas=new OffscreenCanvas(res,res),ctx=canvas.getContext("2d",{alpha:false}),out=ctx.createImageData(res,res);
    for(let y=0;y<res;y++)for(let x=0;x<res;x++){
      const dir=faceDirection(face,(x+.5)/res,(y+.5)/res,global,warp,global,1),lon=Math.atan2(dir[0],dir[2]),lat=Math.asin(clamp(dir[1],-1,1)),sx=(lon/(2*Math.PI)+.5)*image.width,sy=(.5-lat/Math.PI)*image.height,[r,g,b]=sampleImage(image,sx,sy),o=(y*res+x)*4;
      out.data[o]=r;out.data[o+1]=g;out.data[o+2]=b;out.data[o+3]=255;
    }
    ctx.putImageData(out,0,0);faces.push(ctx.getImageData(0,0,res,res));
  }
  return faces;
}

function centreMetrics(scan,reference,size){
  if(size%2===0)return{score:0,mean:0,margin:0,anchors:[]};
  const area=size*size,mid=Math.floor(size/2),anchors=[];let total=0;
  for(let face=0;face<6;face++){
    const tile=face*area+mid*size+mid,target=tile;let correct=-Infinity,bestRot=0;
    for(let rot=0;rot<4;rot++){const s=similarity(scan[tile*4+rot],reference[target]);if(s>correct){correct=s;bestRot=rot;}}
    let wrong=0;for(let other=0;other<6;other++){if(other===face)continue;const otherTarget=other*area+mid*size+mid;for(let rot=0;rot<4;rot++)wrong=Math.max(wrong,similarity(scan[tile*4+rot],reference[otherTarget]));}
    const margin=correct-wrong;total+=correct+.35*margin;anchors.push({target:FACE_NAMES[face],source:FACE_NAMES[face],score:correct,wrongScore:wrong,margin,scanRotation:bestRot,identityConfidence:1});
  }
  return{score:total/6,mean:anchors.reduce((s,a)=>s+a.score,0)/6,margin:anchors.reduce((s,a)=>s+a.margin,0)/6,anchors,identityConfidence:1,identityAmbiguous:false};
}

function hungarianMax(matrix){
  const n=matrix.length,u=new Float64Array(n+1),v=new Float64Array(n+1),p=new Int32Array(n+1),way=new Int32Array(n+1);
  for(let i=1;i<=n;i++){p[0]=i;let j0=0;const minv=new Float64Array(n+1);minv.fill(Infinity);const used=new Uint8Array(n+1);do{used[j0]=1;const i0=p[j0];let delta=Infinity,j1=0;for(let j=1;j<=n;j++){if(used[j])continue;const cur=-matrix[i0-1][j-1]-u[i0]-v[j];if(cur<minv[j]){minv[j]=cur;way[j]=j0;}if(minv[j]<delta){delta=minv[j];j1=j;}}for(let j=0;j<=n;j++){if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else minv[j]-=delta;}j0=j1;}while(p[j0]!==0);do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);}
  const assignment=new Int32Array(n);assignment.fill(-1);for(let j=1;j<=n;j++)if(p[j]>0)assignment[p[j]-1]=j-1;return assignment;
}

function assignmentStats(scan,size,reference){
  const tileCount=6*size*size,odd=size%2===1,area=size*size,mid=Math.floor(size/2),centreLocal=mid*size+mid,isCentre=index=>odd&&(index%area)===centreLocal,matrix=Array.from({length:tileCount},()=>new Float64Array(tileCount));
  for(let tile=0;tile<tileCount;tile++)for(let target=0;target<tileCount;target++){
    const tileCentre=isCentre(tile),targetCentre=isCentre(target),sameCentre=tileCentre&&targetCentre&&Math.floor(tile/area)===Math.floor(target/area),allowed=!odd||(!tileCentre&&!targetCentre)||sameCentre;let best=0;
    if(allowed)for(let rot=0;rot<4;rot++)best=Math.max(best,similarity(scan[tile*4+rot],reference[target]));
    matrix[tile][target]=best+(sameCentre?4:0);
  }
  const assignment=hungarianMax(matrix);let raw=0,distinct=0;
  for(let tile=0;tile<tileCount;tile++){
    const target=assignment[tile],boost=odd&&isCentre(tile)&&target===tile?4:0,assigned=target>=0?matrix[tile][target]-boost:0;raw+=assigned;
    const row=Array.from(matrix[tile],v=>v>1?v-4:v),ordered=[...row].sort((a,b)=>a-b),med=ordered[Math.floor(ordered.length/2)],best=ordered.at(-1),spread=Math.max(0,best-med),reliability=clamp((spread-.01)/.10),rank=row.filter(v=>v<assigned).length/Math.max(1,row.length-1);distinct+=reliability*clamp((rank-.42)/.58);
  }
  return{rawFit:raw/tileCount,distinctiveness:distinct/tileCount,assignment};
}

function evaluate(image,scan,size,orientation,res=42){
  const faces=projectCube(image,res,orientation),reference=referenceDescriptors(faces,size),centres=centreMetrics(scan,reference,size),assignment=assignmentStats(scan,size,reference),full=clamp(assignment.rawFit*(.55+.45*assignment.distinctiveness)),objective=size%2===1?.72*centres.score+.28*full:full;
  return{orientation:cloneOrientation(orientation),faces,reference,centres,assignment,objective,full};
}

function wrapAngle(v){const p=Math.PI*2;return((v%p)+p)%p;}
async function refineAutomatic(candidate,data){
  if(!candidate?.usable||candidate?.projection?.kind!=="equirectangular"||!candidate?.thumbnailUrl)return candidate;
  const raw=new Uint8Array(data.rawBuffer),tileSize=Number(data.tileSize||48),size=Number(data.size||3),tileCount=6*size*size,image=await imageDataFromUrl(candidate.thumbnailUrl),scan=scanDescriptors(raw,tileSize,tileCount),seed=cloneOrientation(candidate.projection.orientation||candidate.automaticBaseline?.orientation||{}),deg=Math.PI/180;
  status("reference-topology","Refining one global cube wrap from centres and all unique tiles…",.79);
  let best=evaluate(image,scan,size,seed,42),evaluated=1;
  for(const step of[4,2,1,.5,.25]){
    let local=best;
    for(const dy of[-step,0,step])for(const dp of[-step,0,step])for(const dr of[-step,0,step]){
      if(dy===0&&dp===0&&dr===0)continue;
      const orientation={yaw:wrapAngle(best.orientation.yaw+dy*deg),pitch:clamp(best.orientation.pitch+dp*deg,-Math.PI/2,Math.PI/2),roll:wrapAngle(best.orientation.roll+dr*deg)},probe=evaluate(image,scan,size,orientation,42);evaluated++;
      if(probe.objective>local.objective)local=probe;
    }
    best=local;
    status("reference-topology",`Connected cube fit · ${evaluated} poses checked`,.79+.12*(1-[4,2,1,.5,.25].indexOf(step)/6));
  }

  const faces=projectCube(image,192,best.orientation),reference=referenceDescriptors(faces,size),glareFraction=estimateGlareFraction(raw,tileSize,tileCount),evidence=buildEvidence(scan,size,reference,glareFraction),previews=[];
  for(const face of faces)previews.push(await facePreview(face));
  const alignment={...centreMetrics(scan,reference,size),hardAnchored:size%2===1,kind:"global connected-cube recognition"};
  return{
    ...candidate,
    fit:evidence.fit,
    rawFit:evidence.raw_fit,
    distinctiveness:evidence.distinctiveness,
    evidence,
    facePreviews:previews,
    alignment,
    layout:`${candidate.layout||"equirectangular"} · one connected cube surface`,
    projection:{...(candidate.projection||{}),orientation:{...best.orientation},automaticOrientation:{...best.orientation},faceOrientations:Object.fromEntries(FACE_NAMES.map(face=>[face,{...best.orientation}])),surfacePartition:"connected-cube-surface",sourceOverlapAllowed:false,sourceOverlapFraction:0,seamPinned:true,noStretchClamping:true,mappingVersion:4},
    automaticBaseline:{...(candidate.automaticBaseline||{}),fit:evidence.fit,rawFit:evidence.raw_fit,distinctiveness:evidence.distinctiveness,alignment,orientation:{...best.orientation},facePreviews:[...previews]},
    automaticMapping:{model:"one global cube pose + hard centre anchors + unique full-surface tile assignment",posesEvaluated:evaluated,objective:best.objective,fullSurfaceFit:best.full,centreScore:alignment.score},
  };
}

function buildEvidence(scan,size,reference,glareFraction=0){
  const tileCount=6*size*size,states=tileCount*4,scores=new Float32Array(states*tileCount),matrix=Array.from({length:tileCount},()=>new Float64Array(tileCount)),assignmentMatrix=Array.from({length:tileCount},()=>new Float64Array(tileCount)),odd=size%2===1,area=size*size,mid=Math.floor(size/2),centreLocal=mid*size+mid,isCentre=index=>odd&&(index%area)===centreLocal;
  for(let tile=0;tile<tileCount;tile++)for(let target=0;target<tileCount;target++){const tileCentre=isCentre(tile),targetCentre=isCentre(target),sameCentre=tileCentre&&targetCentre&&Math.floor(tile/area)===Math.floor(target/area),allowed=!odd||(!tileCentre&&!targetCentre)||sameCentre;let best=0;for(let rot=0;rot<4;rot++){const state=tile*4+rot,s=allowed?similarity(scan[state],reference[target]):0;scores[state*tileCount+target]=s;if(s>best)best=s;}matrix[tile][target]=best;assignmentMatrix[tile][target]=best+(sameCentre?4:0);}
  const assignment=hungarianMax(assignmentMatrix);let rawFit=0,distinctiveness=0;for(let tile=0;tile<tileCount;tile++){const assigned=assignment[tile]>=0?matrix[tile][assignment[tile]]:0;rawFit+=assigned;const row=Array.from(matrix[tile]),ordered=[...row].sort((a,b)=>a-b),medianValue=ordered[Math.floor(ordered.length/2)],best=ordered.at(-1),spread=Math.max(0,best-medianValue),reliability=clamp((spread-.010)/.10),rank=row.filter(v=>v<assigned).length/Math.max(1,row.length-1);distinctiveness+=reliability*clamp((rank-.42)/.58);}
  rawFit/=tileCount;distinctiveness/=tileCount;const fit=clamp(rawFit*(.42+.58*distinctiveness));return{version:4,states,targets:tileCount,absolute_f32_b64:bytesToBase64(new Uint8Array(scores.buffer)),fit,raw_fit:rawFit,distinctiveness,glare_fraction:glareFraction,hard_fixed_centres:odd,centre_identity_confidence:odd?1:null,centre_identity_ambiguous:false,surface_partition:"connected-cube-surface",source_overlap_allowed:false,seam_pinned:true,no_stretch_clamping:true};
}
async function facePreview(image){const res=112,source=new OffscreenCanvas(image.width,image.height),sctx=source.getContext("2d",{alpha:false});sctx.putImageData(image,0,0);const scaled=new OffscreenCanvas(res,res),ctx=scaled.getContext("2d",{alpha:false});ctx.drawImage(source,0,0,image.width,image.height,0,0,res,res);const blob=await scaled.convertToBlob({type:"image/jpeg",quality:.84}),bytes=new Uint8Array(await blob.arrayBuffer());return`data:image/jpeg;base64,${bytesToBase64(bytes)}`;}

inner.addEventListener("message",async event=>{
  const msg=event.data||{};
  if(msg.type==="reference-result"&&pendingMatch){
    const pending=pendingMatch;pendingMatch=null;
    try{
      const candidate=await refineAutomatic(msg.candidates?.[0],pending);
      postMessage({...msg,candidates:candidate?[candidate]:msg.candidates,selectedIndex:candidate?.usable?0:-1});
    }catch(error){
      console.warn("Connected cube automatic refinement failed",error);
      postMessage(msg);
    }
    return;
  }
  postMessage(msg);
});
inner.addEventListener("error",event=>postMessage({type:"reference-error",message:event.message||"Reference recognition worker failed"}));

self.addEventListener("message",event=>{
  const data=event.data||{};
  if(data.type==="match"&&data.rawBuffer){
    pendingMatch={rawBuffer:data.rawBuffer.slice(0),tileSize:data.tileSize,size:data.size};
    inner.postMessage(data,[data.rawBuffer]);
    return;
  }
  if(data.rawBuffer)inner.postMessage(data,[data.rawBuffer]);else inner.postMessage(data);
});
