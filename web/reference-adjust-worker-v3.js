import {
  FACE_NAMES, clamp, cloneOrientation, blankWarp, normaliseWarp,
  residualSafety, faceDirection, topologyMetadata,
} from "./cube-surface-map.js";

const TRANSFORM_KEYS=["move","rotate","scale","warp","yaw","pitch","roll"];
const median=(values)=>{const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const cloneFaceOrientations=(value,fallback)=>Object.fromEntries(FACE_NAMES.map(face=>[face,cloneOrientation(value?.[face]||fallback)]));
const cloneLockedFaces=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Boolean(Array.isArray(value)?value.includes(face):value?.[face])]));
const cloneTransformLocks=(value)=>Object.fromEntries(FACE_NAMES.map(face=>[face,Object.fromEntries(TRANSFORM_KEYS.map(key=>[key,Boolean(value?.[face]?.[key])]))]));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

function orientationDistance(a,b){
  if(!a||!b)return 0;
  const axes=[[1,0,0],[0,1,0],[0,0,1]],rotate=(v,o)=>{
    const cy=Math.cos(o?.yaw||0),sy=Math.sin(o?.yaw||0),cp=Math.cos(o?.pitch||0),sp=Math.sin(o?.pitch||0),cr=Math.cos(o?.roll||0),sr=Math.sin(o?.roll||0);
    let[x,y,z]=v;[x,z]=[cy*x+sy*z,-sy*x+cy*z];[y,z]=[cp*y-sp*z,sp*y+cp*z];[x,y]=[cr*x-sr*y,sr*x+cr*y];return[x,y,z];
  };
  let trace=0;for(const axis of axes)trace+=dot(rotate(axis,a),rotate(axis,b));
  return Math.acos(clamp((trace-1)/2,-1,1));
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

const imageCache=new Map();
async function imageDataFromUrl(url,maxSide=1024){
  const key=`${url}|${maxSide}`;if(imageCache.has(key))return imageCache.get(key);
  const promise=(async()=>{const response=await fetch(url);if(!response.ok)throw new Error(`Reference fetch ${response.status}`);const blob=await response.blob(),bitmap=await createImageBitmap(blob);try{const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale)),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);return ctx.getImageData(0,0,w,h);}finally{bitmap.close?.();}})();
  imageCache.set(key,promise);try{return await promise;}catch(error){imageCache.delete(key);throw error;}
}
function sampleImage(image,x,y){
  let ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const{data,width,height}=image;ix=((ix%width)+width)%width;iy=Math.max(0,Math.min(height-1,iy));
  const ix1=(ix+1)%width,iy1=Math.min(height-1,iy+1),out=[0,0,0];for(let c=0;c<3;c++){const a=data[(iy*width+ix)*4+c]*(1-fx)+data[(iy*width+ix1)*4+c]*fx,b=data[(iy1*width+ix)*4+c]*(1-fx)+data[(iy1*width+ix1)*4+c]*fx;out[c]=a*(1-fy)+b*fy;}return out;
}

function projectConnectedCube(image,res,orientation,warps,faceOrientations){
  const faces=[],global=cloneOrientation(orientation),safeties={};
  for(const faceName of FACE_NAMES){
    safeties[faceName]=residualSafety(warps?.[faceName]||blankWarp(),faceOrientations?.[faceName]||global,global);
  }
  for(let face=0;face<6;face++){
    const name=FACE_NAMES[face],warp=warps?.[name]||blankWarp(),effective=faceOrientations?.[name]||global,strength=safeties[name],canvas=new OffscreenCanvas(res,res),ctx=canvas.getContext("2d",{alpha:false}),out=ctx.createImageData(res,res);
    for(let y=0;y<res;y++)for(let x=0;x<res;x++){
      const u=(x+.5)/res,v=(y+.5)/res,dir=faceDirection(face,u,v,global,warp,effective,strength),lon=Math.atan2(dir[0],dir[2]),lat=Math.asin(clamp(dir[1],-1,1)),sx=(lon/(2*Math.PI)+.5)*image.width,sy=(.5-lat/Math.PI)*image.height,[r,g,b]=sampleImage(image,sx,sy),o=(y*res+x)*4;
      out.data[o]=r;out.data[o+1]=g;out.data[o+2]=b;out.data[o+3]=255;
    }
    ctx.putImageData(out,0,0);faces.push(ctx.getImageData(0,0,res,res));
  }
  return{faces,geometry:topologyMetadata(safeties)};
}

function descriptorFromPixels(readPixel,x0,y0,x1,y1,side=10){
  const vals=new Float32Array(side*side*4);let mean=0,p=0;for(let y=0;y<side;y++)for(let x=0;x<side;x++){const sx=x0+(x+.5)*(x1-x0)/side,sy=y0+(y+.5)*(y1-y0)/side,[r,g,b]=readPixel(sx,sy),sum=r+g+b+1,lum=(.2126*r+.7152*g+.0722*b)/255;vals[p++]=r/sum;vals[p++]=g/sum;vals[p++]=b/sum;vals[p++]=lum;mean+=lum;}
  mean/=side*side;const out=[];for(let i=0;i<side*side;i++)out.push(vals[i*4]*.75,vals[i*4+1]*.75,vals[i*4+2]*.75,(vals[i*4+3]-mean)*.45);for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){const i=y*side+x;out.push((vals[(i+1)*4+3]-vals[(i-1)*4+3])*.75,(vals[(i+side)*4+3]-vals[(i-side)*4+3])*.75);}const n=Math.sqrt(out.reduce((s,v)=>s+v*v,0))||1;return Float32Array.from(out,v=>v/n);
}
const stateDescriptor=(raw,tileSize,state)=>descriptorFromPixels((x,y)=>statePixel(raw,tileSize,state,clamp(Math.floor(x),0,tileSize-1),clamp(Math.floor(y),0,tileSize-1)),0,0,tileSize,tileSize);
const imageDescriptor=(image,x0,y0,x1,y1)=>descriptorFromPixels((x,y)=>sampleImage(image,x,y),x0,y0,x1,y1);
const similarity=(a,b)=>{let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=a[i]*b[i];return clamp((s+1)/2);};
function scanDescriptors(raw,tileSize,tileCount){const out=new Array(tileCount*4);for(let state=0;state<out.length;state++)out[state]=stateDescriptor(raw,tileSize,state);return out;}
function referenceDescriptors(faceImages,size){const out=[];for(let face=0;face<6;face++){const img=faceImages[face];for(let row=0;row<size;row++)for(let col=0;col<size;col++)out.push(imageDescriptor(img,col*img.width/size,row*img.height/size,(col+1)*img.width/size,(row+1)*img.height/size));}return out;}

function centreAnchorMetrics(scan,reference,size){
  if(size%2===0)return{score:0,mean:0,margin:0,anchors:[],identityConfidence:null,identityAmbiguous:false};
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
function bytesToBase64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function buildEvidence(scan,size,reference,glareFraction=0){
  const tileCount=6*size*size,states=tileCount*4,scores=new Float32Array(states*tileCount),matrix=Array.from({length:tileCount},()=>new Float64Array(tileCount)),assignmentMatrix=Array.from({length:tileCount},()=>new Float64Array(tileCount)),odd=size%2===1,area=size*size,mid=Math.floor(size/2),centreLocal=mid*size+mid,isCentre=index=>odd&&(index%area)===centreLocal;
  for(let tile=0;tile<tileCount;tile++)for(let target=0;target<tileCount;target++){
    const tileCentre=isCentre(tile),targetCentre=isCentre(target),sameCentre=tileCentre&&targetCentre&&Math.floor(tile/area)===Math.floor(target/area),allowed=!odd||(!tileCentre&&!targetCentre)||sameCentre;let best=0;
    for(let rot=0;rot<4;rot++){const state=tile*4+rot,s=allowed?similarity(scan[state],reference[target]):0;scores[state*tileCount+target]=s;if(s>best)best=s;}
    matrix[tile][target]=best;assignmentMatrix[tile][target]=best+(sameCentre?4:0);
  }
  const assignment=hungarianMax(assignmentMatrix);let rawFit=0,distinctiveness=0;
  for(let tile=0;tile<tileCount;tile++){
    const assigned=assignment[tile]>=0?matrix[tile][assignment[tile]]:0;rawFit+=assigned;const row=Array.from(matrix[tile]),ordered=[...row].sort((a,b)=>a-b),medianValue=ordered[Math.floor(ordered.length/2)],best=ordered[ordered.length-1],spread=Math.max(0,best-medianValue),reliability=clamp((spread-.010)/.10),rank=row.filter(v=>v<assigned).length/Math.max(1,row.length-1);distinctiveness+=reliability*clamp((rank-.42)/.58);
  }
  rawFit/=tileCount;distinctiveness/=tileCount;const fit=clamp(rawFit*(.42+.58*distinctiveness));
  return{version:4,states,targets:tileCount,absolute_f32_b64:bytesToBase64(new Uint8Array(scores.buffer)),fit,raw_fit:rawFit,distinctiveness,glare_fraction:glareFraction,hard_fixed_centres:odd,centre_identity_confidence:odd?1:null,centre_identity_ambiguous:false,surface_partition:"connected-cube-surface",source_overlap_allowed:false,seam_pinned:true,no_stretch_clamping:true};
}
async function facePreview(image){const res=112,source=new OffscreenCanvas(image.width,image.height),sctx=source.getContext("2d",{alpha:false});sctx.putImageData(image,0,0);const scaled=new OffscreenCanvas(res,res),ctx=scaled.getContext("2d",{alpha:false});ctx.drawImage(source,0,0,image.width,image.height,0,0,res,res);const blob=await scaled.convertToBlob({type:"image/jpeg",quality:.84}),bytes=new Uint8Array(await blob.arrayBuffer());return`data:image/jpeg;base64,${bytesToBase64(bytes)}`;}
function compactAlignment(alignment){if(!alignment)return null;return{kind:alignment.kind||"",hardAnchored:Boolean(alignment.hardAnchored),score:Number(alignment.score||0),mean:Number(alignment.mean||0),margin:Number(alignment.margin||0),identityConfidence:Number(alignment.identityConfidence??1),identityAmbiguous:Boolean(alignment.identityAmbiguous),anchors:(alignment.anchors||[]).map(a=>({target:a.target,source:a.source,score:Number(a.score||0),wrongScore:Number(a.wrongScore||0),margin:Number(a.margin||0),scanRotation:Number(a.scanRotation||0),identityConfidence:Number(a.identityConfidence??1)}))};}
function diagnosticComparison(candidate,alignment,evidence,orientation,faceOrientations,geometry){
  const auto=candidate.automaticBaseline||{fit:Number(candidate.fit||0),rawFit:Number(candidate.rawFit||0),distinctiveness:Number(candidate.distinctiveness||0),alignment:compactAlignment(candidate.alignment),orientation:candidate.projection?.automaticOrientation||candidate.projection?.orientation||null};
  const autoAnchors=new Map((auto.alignment?.anchors||[]).map(a=>[a.target,a])),currentAnchors=new Map((alignment?.anchors||[]).map(a=>[a.target,a]));
  return{version:4,angularErrorRad:orientationDistance(auto.orientation,orientation),angularErrorDeg:orientationDistance(auto.orientation,orientation)*180/Math.PI,surface:geometry,automatic:{orientation:auto.orientation||null,fit:Number(auto.fit||0),rawFit:Number(auto.rawFit||0),distinctiveness:Number(auto.distinctiveness||0),centreMean:Number(auto.alignment?.mean||0),centreMargin:Number(auto.alignment?.margin||0)},corrected:{orientation,faceOrientations,fit:Number(evidence?.fit||0),rawFit:Number(evidence?.raw_fit||0),distinctiveness:Number(evidence?.distinctiveness||0),centreMean:Number(alignment?.mean||0),centreMargin:Number(alignment?.margin||0)},faces:FACE_NAMES.map(face=>{const a=autoAnchors.get(face)||{},c=currentAnchors.get(face)||{};return{face,automatic:{score:Number(a.score||0),wrongScore:Number(a.wrongScore||0),margin:Number(a.margin||0)},corrected:{score:Number(c.score||0),wrongScore:Number(c.wrongScore||0),margin:Number(c.margin||0),identityConfidence:1}};})};
}

let session=null;
async function startAdjustment(data){
  const raw=new Uint8Array(data.rawBuffer),tileSize=Number(data.tileSize||48),size=Number(data.size||3),candidate=data.candidate;
  if(candidate?.projection?.kind!=="equirectangular"||!candidate?.thumbnailUrl)throw new Error("This reference cannot be manually wrapped");
  const image=await imageDataFromUrl(candidate.thumbnailUrl),tileCount=6*size*size,scan=scanDescriptors(raw,tileSize,tileCount),glareFraction=estimateGlareFraction(raw,tileSize,tileCount);
  session={raw,tileSize,size,candidate,image,scan,glareFraction};
  postMessage({type:"reference-adjust-ready",sessionId:String(data.sessionId||""),candidate});
}
async function renderAdjustment(data,commit=false){
  if(!session)throw new Error("Reference adjustment session is not ready");
  const requestId=Number(data.requestId||0),adjustment=data.adjustment||{},fallback=session.candidate.projection?.orientation||session.candidate.automaticBaseline?.orientation||{},orientation=cloneOrientation(adjustment.orientation||fallback),warps=Object.fromEntries(FACE_NAMES.map(face=>[face,normaliseWarp(adjustment.faceWarps?.[face]||session.candidate.projection?.faceWarps?.[face])])),faceOrientations=cloneFaceOrientations(adjustment.faceOrientations||session.candidate.projection?.faceOrientations,orientation),lockedFaces=cloneLockedFaces(adjustment.lockedFaces??session.candidate.projection?.lockedFaces),transformLocks=cloneTransformLocks(adjustment.transformLocks||session.candidate.projection?.transformLocks),res=commit?192:128;
  const projected=projectConnectedCube(session.image,res,orientation,warps,faceOrientations),faces=projected.faces,geometry=projected.geometry,descriptors=referenceDescriptors(faces,session.size),alignment={...centreAnchorMetrics(session.scan,descriptors,session.size),hardAnchored:session.size%2===1,kind:"connected cube-surface wrap"},previews=[];
  for(const face of faces)previews.push(await facePreview(face));
  let evidence=null,candidate=null;const diagnostics=diagnosticComparison(session.candidate,alignment,null,orientation,faceOrientations,geometry);
  if(commit){
    evidence={...buildEvidence(session.scan,session.size,descriptors,session.glareFraction),face_domain_clipped_fraction:0,min_residual_attenuation:geometry.minResidualAttenuation};
    const committedDiagnostics=diagnosticComparison(session.candidate,alignment,evidence,orientation,faceOrientations,geometry);
    candidate={...session.candidate,usable:true,fit:evidence.fit,rawFit:evidence.raw_fit,distinctiveness:evidence.distinctiveness,evidence,facePreviews:previews,alignment,projection:{...(session.candidate.projection||{}),kind:"equirectangular",editable:true,orientation:{...orientation},automaticOrientation:{...(session.candidate.projection?.automaticOrientation||session.candidate.automaticBaseline?.orientation||orientation)},faceOrientations,faceWarps:warps,lockedFaces,transformLocks,manual:true,mappingVersion:4,surfacePartition:"connected-cube-surface",sourceOverlapAllowed:false,sourceOverlapFraction:0,seamPinned:true,noStretchClamping:true,faceDomainClippedFraction:0,faceResidualAttenuation:geometry.faceResidualAttenuation,minResidualAttenuation:geometry.minResidualAttenuation},manualDiagnostics:committedDiagnostics};
  }
  postMessage({type:commit?"reference-adjust-commit":"reference-adjust-preview",sessionId:String(data.sessionId||""),requestId,facePreviews:previews,alignment,diagnostics:commit?candidate.manualDiagnostics:diagnostics,candidate,projection:{kind:"equirectangular",orientation,faceOrientations,faceWarps:warps,lockedFaces,transformLocks,mappingVersion:4,surfacePartition:"connected-cube-surface",sourceOverlapAllowed:false,sourceOverlapFraction:0,seamPinned:true,noStretchClamping:true,faceDomainClippedFraction:0,faceResidualAttenuation:geometry.faceResidualAttenuation,minResidualAttenuation:geometry.minResidualAttenuation}});
}

self.addEventListener("message",async event=>{
  try{
    const data=event.data||{};
    if(data.type==="adjust-start")await startAdjustment(data);
    else if(data.type==="adjust-preview")await renderAdjustment(data,false);
    else if(data.type==="adjust-commit")await renderAdjustment(data,true);
    else if(data.type==="adjust-end")session=null;
    else throw new Error(`Unknown adjustment worker message: ${data.type}`);
  }catch(error){postMessage({type:"reference-adjust-error",sessionId:String(event.data?.sessionId||""),requestId:Number(event.data?.requestId||0),message:error instanceof Error?error.message:String(error)});}
});
