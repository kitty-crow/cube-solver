const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const FACE_NORMAL = [[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
const FACE_RIGHT = [[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
const FACE_UP = [[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];

function add(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function mul(a,k){return[a[0]*k,a[1]*k,a[2]*k];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function neg(a){return[-a[0],-a[1],-a[2]];}
function same(a,b){return a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];}
function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v));}
function median(values){const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function matVec(m,v){return[m.x[0]*v[0]+m.y[0]*v[1]+m.z[0]*v[2],m.x[1]*v[0]+m.y[1]*v[1]+m.z[1]*v[2],m.x[2]*v[0]+m.y[2]*v[1]+m.z[2]*v[2]];}
function invMatVec(m,v){return[dot(m.x,v),dot(m.y,v),dot(m.z,v)];}
function faceForNormal(n){return FACE_NORMAL.findIndex(x=>same(x,n));}

function allCubeRotations(){
  const axes=[[1,0,0],[0,1,0],[0,0,1]],signed=axes.concat(axes.map(neg)),out=[];
  for(const x of signed)for(const y of signed){
    if(dot(x,y)!==0)continue;
    const z=cross(x,y),key=`${x}|${y}|${z}`;
    if(!out.some(r=>r.key===key))out.push({key,x,y,z});
  }
  return out;
}
const CUBE_ROTATIONS=allCubeRotations();

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

function descriptorFromPixels(readPixel,x0,y0,x1,y1,side=10){
  const vals=new Float32Array(side*side*4);let mean=0,p=0;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){const sx=x0+(x+.5)*(x1-x0)/side,sy=y0+(y+.5)*(y1-y0)/side,[r,g,b]=readPixel(sx,sy),sum=r+g+b+1,lum=(.2126*r+.7152*g+.0722*b)/255;vals[p++]=r/sum;vals[p++]=g/sum;vals[p++]=b/sum;vals[p++]=lum;mean+=lum;}
  mean/=side*side;const out=[];for(let i=0;i<side*side;i++)out.push(vals[i*4]*.75,vals[i*4+1]*.75,vals[i*4+2]*.75,(vals[i*4+3]-mean)*.45);for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){const i=y*side+x;out.push((vals[(i+1)*4+3]-vals[(i-1)*4+3])*.75,(vals[(i+side)*4+3]-vals[(i-side)*4+3])*.75);}const n=Math.sqrt(out.reduce((s,v)=>s+v*v,0))||1;return Float32Array.from(out,v=>v/n);
}
function scanCentreDescriptors(raw,tileSize,size){
  const area=size*size,mid=Math.floor(size/2),out=[];
  for(let face=0;face<6;face++){const tile=face*area+mid*size+mid,rots=[];for(let rot=0;rot<4;rot++)rots.push(descriptorFromPixels((x,y)=>statePixel(raw,tileSize,tile*4+rot,clamp(Math.floor(x),0,tileSize-1),clamp(Math.floor(y),0,tileSize-1)),0,0,tileSize,tileSize));out.push(rots);}
  return out;
}
function similarity(a,b){let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=a[i]*b[i];return clamp((s+1)/2);}

async function dataUrlImageData(url){
  const blob=await(await fetch(url)).blob(),bitmap=await createImageBitmap(blob);
  try{const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext("2d",{alpha:false,willReadFrequently:true});ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,bitmap.width,bitmap.height);}finally{bitmap.close?.();}
}
function sampleFace(image,x,y){
  const ix=clamp(Math.round(x),0,image.width-1),iy=clamp(Math.round(y),0,image.height-1),o=(iy*image.width+ix)*4;return[image.data[o],image.data[o+1],image.data[o+2]];
}
function centreDescriptor(image){const w=image.width,h=image.height;return descriptorFromPixels((x,y)=>sampleFace(image,x,y),w/3,h/3,2*w/3,2*h/3);}

function rotateFaceImages(images,m){
  if(!m)return images;
  const out=new Array(6);
  for(let targetFace=0;targetFace<6;targetFace++){
    const sourceNormal=invMatVec(m,FACE_NORMAL[targetFace]),sourceFace=faceForNormal(sourceNormal),src=images[sourceFace],w=src.width,h=src.height,c=new OffscreenCanvas(w,h),ctx=c.getContext("2d",{alpha:false}),dst=ctx.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=2*(x+.5)/w-1,v=1-2*(y+.5)/h,targetTangent=add(mul(FACE_RIGHT[targetFace],u),mul(FACE_UP[targetFace],v)),sourceTangent=invMatVec(m,targetTangent),su=dot(sourceTangent,FACE_RIGHT[sourceFace]),sv=dot(sourceTangent,FACE_UP[sourceFace]),sx=(su+1)*.5*w-.5,sy=(1-sv)*.5*h-.5,[r,g,b]=sampleFace(src,sx,sy),o=(y*w+x)*4;
      dst.data[o]=r;dst.data[o+1]=g;dst.data[o+2]=b;dst.data[o+3]=255;
    }
    ctx.putImageData(dst,0,0);out[targetFace]=dst;
  }
  return out;
}

function bestAlignment(scanCentres,referenceImages){
  const refCentres=referenceImages.map(centreDescriptor);let best=null,second=-Infinity;
  for(const m of CUBE_ROTATIONS){
    let score=0;const anchors=[];
    for(let targetFace=0;targetFace<6;targetFace++){
      const sourceFace=faceForNormal(invMatVec(m,FACE_NORMAL[targetFace])),ref=refCentres[sourceFace];let local=-Infinity,bestRot=0;
      for(let rot=0;rot<4;rot++){const s=similarity(scanCentres[targetFace][rot],ref);if(s>local){local=s;bestRot=rot;}}
      score+=local;anchors.push({target:FACE_NAMES[targetFace],source:FACE_NAMES[sourceFace],score:local,scanRotation:bestRot});
    }
    if(!best||score>best.score){second=best?.score??second;best={rotation:m,score,anchors};}else if(score>second)second=score;
  }
  best.margin=(best.score-second)/6;best.meanScore=best.score/6;return best;
}

async function previewDataUrl(image){
  const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext("2d",{alpha:false});ctx.putImageData(image,0,0);const blob=await c.convertToBlob({type:"image/jpeg",quality:.82}),bytes=new Uint8Array(await blob.arrayBuffer());let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return`data:image/jpeg;base64,${btoa(s)}`;
}

async function canonicaliseCandidate(candidate,scanCentres,size){
  if(!candidate?.usable||size%2===0||candidate.facePreviews?.length!==6)return candidate;
  const images=[];for(const url of candidate.facePreviews)images.push(await dataUrlImageData(url));
  const alignment=bestAlignment(scanCentres,images),aligned=rotateFaceImages(images,alignment.rotation),previews=[];for(const image of aligned)previews.push(await previewDataUrl(image));
  return{...candidate,facePreviews:previews,alignment:{meanScore:alignment.meanScore,margin:alignment.margin,anchors:alignment.anchors}};
}

let child=null,lastScan=null,lastTileSize=0,lastSize=3;
function ensureChild(){
  if(child)return child;
  child=new Worker(new URL("./reference-v2-worker.js",self.location.href),{type:"module"});
  child.addEventListener("message",async(event)=>{
    const msg=event.data||{};
    if(msg.type!=="reference-result"){postMessage(msg);return;}
    try{
      const scanCentres=lastSize%2===1?scanCentreDescriptors(lastScan,lastTileSize,lastSize):null,candidates=[];
      for(const candidate of msg.candidates||[])candidates.push(scanCentres?await canonicaliseCandidate(candidate,scanCentres,lastSize):candidate);
      postMessage({...msg,candidates});
    }catch(error){postMessage({type:"reference-warning",message:`Reference preview alignment unavailable: ${error?.message||error}`});postMessage(msg);}
  });
  child.addEventListener("error",event=>postMessage({type:"reference-error",message:event.message||"Reference worker failed"}));
  return child;
}

self.addEventListener("message",event=>{
  const data=event.data||{};
  if(data.type!=="analyse"){postMessage({type:"reference-error",message:`Unknown reference worker message: ${data.type}`});return;}
  const raw=new Uint8Array(data.rawBuffer);lastScan=raw.slice();lastTileSize=Number(data.tileSize||48);lastSize=Number(data.size||3);
  const forwarded=lastScan.slice();ensureChild().postMessage({...data,rawBuffer:forwarded.buffer},[forwarded.buffer]);
});
