import { detectMlCapabilities } from "./ml-capabilities.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const FACE_NORMAL = [[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
const FACE_RIGHT = [[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
const FACE_UP = [[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];
const LABELS = [
  "planet Earth, a globe, or a world map", "a geographic map or cartographic image",
  "ocean or sea", "a coastline", "a continent or land map", "outer space or stars",
  "the Moon or another planet", "sky or clouds", "a landscape", "mountains", "forest or trees",
  "flowers or plants", "an animal", "a cat", "a dog", "a bird", "a human portrait", "people",
  "a city or skyline", "architecture or a building", "a vehicle", "an aeroplane", "a ship or boat",
  "food", "a painting or artwork", "a cartoon or illustration", "a fantasy scene", "abstract art",
  "a geometric pattern", "text or a logo", "a flag", "sports", "fire", "ice or snow",
];

let transformersPromise;
let capabilitiesPromise;

function status(stage, detail, progress) { postMessage({ type: "reference-status", stage, detail, progress }); }
function capabilities() { return capabilitiesPromise ||= detectMlCapabilities(); }
function transformers() { return transformersPromise ||= import(TRANSFORMERS_URL); }
function add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function mul(a,k){ return [a[0]*k,a[1]*k,a[2]*k]; }
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function neg(a){ return [-a[0],-a[1],-a[2]]; }
function same(a,b){ return a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2]; }
function key(v){ return v.join(","); }
function clamp(v,a=0,b=1){ return Math.max(a,Math.min(b,v)); }
function normalise(v){ const n=Math.hypot(...v)||1; return v.map(x=>x/n); }

function rotate90(vector, axis, quarters) {
  let out=vector;
  for(let i=0;i<((quarters%4)+4)%4;i++) out=add(cross(axis,out),mul(axis,dot(axis,out)));
  return out;
}

function allCubeRotations(){
  const axes=[[1,0,0],[0,1,0],[0,0,1]], signed=axes.concat(axes.map(neg)), out=[];
  for(const x of signed) for(const y of signed){
    if(dot(x,y)!==0) continue;
    const z=cross(x,y), k=`${key(x)}|${key(y)}|${key(z)}`;
    if(!out.some(r=>r.key===k)) out.push({key:k,x,y,z});
  }
  return out;
}
const CUBE_ROTATIONS=allCubeRotations();
function matVec(m,v){ return [m.x[0]*v[0]+m.y[0]*v[1]+m.z[0]*v[2],m.x[1]*v[0]+m.y[1]*v[1]+m.z[1]*v[2],m.x[2]*v[0]+m.y[2]*v[1]+m.z[2]*v[2]]; }
function faceForNormal(n){ return FACE_NORMAL.findIndex(x=>same(x,n)); }

function rotateContinuous(v,yaw,pitch,roll){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  let [x,y,z]=v;
  [x,z]=[cy*x+sy*z,-sy*x+cy*z];
  [y,z]=[cp*y-sp*z,sp*y+cp*z];
  [x,y]=[cr*x-sr*y,sr*x+cr*y];
  return [x,y,z];
}

function statePixel(raw,tileSize,state,x,y){
  const tile=Math.floor(state/4), rot=state%4, n=tileSize;
  let ox=x,oy=y;
  if(rot===1){ox=y;oy=n-1-x;} else if(rot===2){ox=n-1-x;oy=n-1-y;} else if(rot===3){ox=n-1-y;oy=x;}
  const o=((tile*n*n)+oy*n+ox)*3;
  return [raw[o],raw[o+1],raw[o+2]];
}

function faceCanvas(raw,tileSize,size,face,resolution=Math.max(128,size*tileSize)){
  const canvas=new OffscreenCanvas(resolution,resolution), ctx=canvas.getContext("2d",{alpha:false});
  const image=ctx.createImageData(resolution,resolution), faceArea=size*size;
  for(let y=0;y<resolution;y++) for(let x=0;x<resolution;x++){
    const gx=(x+.5)*size/resolution, gy=(y+.5)*size/resolution;
    const col=Math.min(size-1,Math.floor(gx)), row=Math.min(size-1,Math.floor(gy));
    const tx=Math.min(tileSize-1,Math.floor((gx-col)*tileSize));
    const ty=Math.min(tileSize-1,Math.floor((gy-row)*tileSize));
    const tile=face*faceArea+row*size+col, [r,g,b]=statePixel(raw,tileSize,tile*4,tx,ty), o=(y*resolution+x)*4;
    image.data[o]=r; image.data[o+1]=g; image.data[o+2]=b; image.data[o+3]=255;
  }
  ctx.putImageData(image,0,0); return canvas;
}

function subjectName(label){
  const s=String(label||"").trim();
  if(/planet earth|globe|world map/i.test(s)) return "planet Earth world map";
  if(/geographic map|cartographic/i.test(s)) return "geographic map";
  return s.replace(/^(a|an|the)\s+/i,"").replace(/\bor\b.*$/i,"").trim()||"picture artwork";
}

async function recogniseFaces(raw,tileSize,size){
  const caps=await capabilities();
  const { pipeline }=await transformers();
  let classifier=null;
  try{
    status("recognise","Recognising six cube faces separately…",0.03);
    classifier=await pipeline("zero-shot-image-classification","Xenova/mobileclip_s0",caps.webgpu?{device:"webgpu",dtype:"q4"}:{dtype:"q4"});
    const faces=[]; const totals=new Map();
    for(let face=0;face<6;face++){
      const output=await classifier(faceCanvas(raw,tileSize,size,face,160),LABELS,{hypothesis_template:"This image shows {}"});
      const guesses=Array.from(output||[]).slice(0,5).map(item=>({label:subjectName(item.label),rawLabel:item.label,score:Number(item.score||0)}));
      for(const item of output||[]){
        const label=subjectName(item.label), entry=totals.get(label)||{sum:0,max:0,count:0};
        entry.sum+=Number(item.score||0); entry.max=Math.max(entry.max,Number(item.score||0)); entry.count++; totals.set(label,entry);
      }
      faces.push({face:FACE_NAMES[face],guesses});
      status("recognise",`Recognised face ${face+1} of 6…`,0.03+(face+1)*0.025);
    }
    const aggregate=[...totals.entries()].map(([label,v])=>({label,score:.52*v.max+.48*(v.sum/Math.max(1,v.count))})).sort((a,b)=>b.score-a.score);
    return {subject:aggregate[0]?.label||"picture artwork",aggregate:aggregate.slice(0,6),faces,model:"Xenova/mobileclip_s0"};
  } finally { try{await classifier?.dispose?.();}catch(_){} }
}

function stripHtml(v){return String(v||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();}
async function commonsSearch(query,limit=10){
  const p=new URLSearchParams({action:"query",format:"json",formatversion:"2",origin:"*",generator:"search",gsrsearch:query,gsrnamespace:"6",gsrlimit:String(limit),prop:"imageinfo",iiprop:"url|mime|extmetadata",iiurlwidth:"1024"});
  const r=await fetch(`https://commons.wikimedia.org/w/api.php?${p}`); if(!r.ok) throw new Error(`Commons search ${r.status}`);
  const data=await r.json();
  return (data?.query?.pages||[]).map(page=>{const info=page.imageinfo?.[0]||{}, meta=info.extmetadata||{};return{
    title:page.title||"",thumbnailUrl:info.thumburl||info.url||"",sourceUrl:info.descriptionurl||"",mime:info.mime||"",
    description:stripHtml(meta.ImageDescription?.value||meta.ObjectName?.value||""),artist:stripHtml(meta.Artist?.value||""),licence:stripHtml(meta.LicenseShortName?.value||meta.UsageTerms?.value||"")
  };}).filter(x=>x.thumbnailUrl&&/^image\//.test(x.mime));
}

function searchPriority(c,subject,queryRank){
  const text=`${c.title} ${c.description}`.toLowerCase(); let score=1-queryRank*.04;
  if(/cube.?map|cubemap|cube projection|cube net/.test(text)) score+=2.1;
  if(/equirectangular|plate carr|world map|panorama/.test(text)) score+=1.2;
  if(/texture|projection|map/.test(text)) score+=.35;
  for(const w of subject.toLowerCase().split(/\W+/).filter(x=>x.length>2)) if(text.includes(w)) score+=.1;
  return score;
}

async function searchReferences(subject,faceRecognitions){
  const hints=[...new Set((faceRecognitions||[]).flatMap(f=>f.guesses?.slice(0,2).map(g=>g.label)||[]))].slice(0,4);
  const queries=[`${subject} equirectangular projection`,`${subject} cube map`,`${subject} cubemap texture`,`${subject} panoramic map`,subject,...hints.map(h=>`${subject} ${h}`)];
  const found=new Map();
  for(let qi=0;qi<queries.length;qi++){
    status("search",`Searching references: ${queries[qi]}…`,.19+.12*(qi/queries.length));
    try{for(const c of await commonsSearch(queries[qi],8)){const x={...c,searchPriority:searchPriority(c,subject,qi)};const old=found.get(c.title.toLowerCase());if(!old||x.searchPriority>old.searchPriority)found.set(c.title.toLowerCase(),x);}}catch(_){}
  }
  return [...found.values()].sort((a,b)=>b.searchPriority-a.searchPriority).slice(0,14);
}

async function imageDataFromUrl(url,maxSide=1024){
  const r=await fetch(url,{mode:"cors"});if(!r.ok)throw new Error(`Reference fetch ${r.status}`);const blob=await r.blob();const bitmap=await createImageBitmap(blob);
  try{const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));const c=new OffscreenCanvas(w,h),ctx=c.getContext("2d",{alpha:false,willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);return ctx.getImageData(0,0,w,h);}finally{bitmap.close?.();}
}

function cellActivity(image,col,row,cols,rows){
  const {data,width,height}=image;let sr=0,sg=0,sb=0,s2=0,count=0;
  for(let y=0;y<10;y++)for(let x=0;x<10;x++){const px=Math.min(width-1,Math.floor((col+(x+.5)/10)*width/cols)),py=Math.min(height-1,Math.floor((row+(y+.5)/10)*height/rows)),o=(py*width+px)*4,r=data[o],g=data[o+1],b=data[o+2];sr+=r;sg+=g;sb+=b;s2+=r*r+g*g+b*b;count++;}
  const mr=sr/count,mg=sg/count,mb=sb/count;return Math.sqrt(Math.max(0,s2/count-(mr*mr+mg*mg+mb*mb)))+.04*(Math.max(mr,mg,mb)-Math.min(mr,mg,mb));
}
function combinations(values,k){const out=[];function walk(start,p){if(p.length===k){out.push(p.slice());return;}for(let i=start;i<=values.length-(k-p.length);i++){p.push(values[i]);walk(i+1,p);p.pop();}}walk(0,[]);return out;}
function foldNet(cells){
  const occupied=new Set(cells.map(c=>`${c.col},${c.row}`)),orient=new Map(),first=cells[0];orient.set(`${first.col},${first.row}`,{n:[0,0,1],r:[1,0,0],u:[0,1,0]});const q=[first];
  while(q.length){const cell=q.shift(),o=orient.get(`${cell.col},${cell.row}`),ns=[[cell.col+1,cell.row,o.u,1],[cell.col-1,cell.row,o.u,-1],[cell.col,cell.row-1,o.r,-1],[cell.col,cell.row+1,o.r,1]];
    for(const [col,row,axis,turn] of ns){const k=`${col},${row}`;if(!occupied.has(k))continue;const n={n:rotate90(o.n,axis,turn),r:rotate90(o.r,axis,turn),u:rotate90(o.u,axis,turn)};if(orient.has(k)){const old=orient.get(k);if(!same(old.n,n.n)||!same(old.r,n.r)||!same(old.u,n.u))return null;}else{orient.set(k,n);q.push({col,row});}}
  }
  if(orient.size!==6||new Set([...orient.values()].map(o=>key(o.n))).size!==6)return null;return orient;
}
function detectCubeNet(image){
  const ratio=image.width/image.height,layouts=[];if(Math.abs(ratio-4/3)<.14)layouts.push([4,3]);if(Math.abs(ratio-3/4)<.14)layouts.push([3,4]);let best=null;
  for(const [cols,rows] of layouts){const cells=[];for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)cells.push({col,row,activity:cellActivity(image,col,row,cols,rows)});cells.sort((a,b)=>b.activity-a.activity);for(const chosen of combinations(cells.slice(0,Math.min(9,cells.length)),6)){const orientations=foldNet(chosen);if(!orientations)continue;const score=chosen.reduce((s,c)=>s+c.activity,0);if(!best||score>best.score)best={type:"cube-net",cols,rows,cells:chosen,orientations,score};}}
  return best;
}

function sampleImage(image,x,y){
  let ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const {data,width,height}=image;ix=((ix%width)+width)%width;iy=Math.max(0,Math.min(height-1,iy));const ix1=(ix+1)%width,iy1=Math.min(height-1,iy+1),out=[0,0,0];
  for(let c=0;c<3;c++){const a=data[(iy*width+ix)*4+c]*(1-fx)+data[(iy*width+ix1)*4+c]*fx,b=data[(iy1*width+ix)*4+c]*(1-fx)+data[(iy1*width+ix1)*4+c]*fx;out[c]=a*(1-fy)+b*fy;}return out;
}

function projectEquirectangular(image,res=192,orientation=null){
  const faces=[];
  const yaw=orientation?.yaw||0,pitch=orientation?.pitch||0,roll=orientation?.roll||0;
  for(let face=0;face<6;face++){
    const c=new OffscreenCanvas(res,res),ctx=c.getContext("2d",{alpha:false}),out=ctx.createImageData(res,res);
    for(let y=0;y<res;y++)for(let x=0;x<res;x++){
      const u=2*(x+.5)/res-1,v=1-2*(y+.5)/res;
      let dir=normalise(add(FACE_NORMAL[face],add(mul(FACE_RIGHT[face],u),mul(FACE_UP[face],v))));
      if(orientation) dir=rotateContinuous(dir,yaw,pitch,roll);
      const lon=Math.atan2(dir[0],dir[2]),lat=Math.asin(clamp(dir[1],-1,1)),sx=(lon/(2*Math.PI)+.5)*image.width,sy=(.5-lat/Math.PI)*image.height,[r,g,b]=sampleImage(image,sx,sy),o=(y*res+x)*4;
      out.data[o]=r;out.data[o+1]=g;out.data[o+2]=b;out.data[o+3]=255;
    }
    ctx.putImageData(out,0,0);faces.push(ctx.getImageData(0,0,res,res));
  }
  return faces;
}

function projectCubeNet(image,net,res=192){
  const faces=new Array(6),cw=image.width/net.cols,ch=image.height/net.rows;
  for(const cell of net.cells){const o=net.orientations.get(`${cell.col},${cell.row}`),face=faceForNormal(o.n),c=new OffscreenCanvas(res,res),ctx=c.getContext("2d",{alpha:false}),out=ctx.createImageData(res,res);
    for(let y=0;y<res;y++)for(let x=0;x<res;x++){const u=2*(x+.5)/res-1,v=1-2*(y+.5)/res,tangent=add(mul(FACE_RIGHT[face],u),mul(FACE_UP[face],v)),lu=dot(tangent,o.r),lv=dot(tangent,o.u),sx=(cell.col+(lu+1)/2)*cw,sy=(cell.row+(1-lv)/2)*ch,[r,g,b]=sampleImage(image,sx,sy),p=(y*res+x)*4;out.data[p]=r;out.data[p+1]=g;out.data[p+2]=b;out.data[p+3]=255;}
    ctx.putImageData(out,0,0);faces[face]=ctx.getImageData(0,0,res,res);
  }return faces.every(Boolean)?faces:null;
}

function descriptorFromPixels(readPixel,x0,y0,x1,y1,side=10){
  const vals=new Float32Array(side*side*4);let mean=0,p=0;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){const sx=x0+(x+.5)*(x1-x0)/side,sy=y0+(y+.5)*(y1-y0)/side,[r,g,b]=readPixel(sx,sy),sum=r+g+b+1,lum=(.2126*r+.7152*g+.0722*b)/255;vals[p++]=r/sum;vals[p++]=g/sum;vals[p++]=b/sum;vals[p++]=lum;mean+=lum;}
  mean/=side*side;const out=[];for(let i=0;i<side*side;i++)out.push(vals[i*4]*.75,vals[i*4+1]*.75,vals[i*4+2]*.75,(vals[i*4+3]-mean)*.45);for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){const i=y*side+x;out.push((vals[(i+1)*4+3]-vals[(i-1)*4+3])*.75,(vals[(i+side)*4+3]-vals[(i-side)*4+3])*.75);}let n=Math.sqrt(out.reduce((s,v)=>s+v*v,0))||1;return Float32Array.from(out,v=>v/n);
}
function stateDescriptor(raw,tileSize,state){return descriptorFromPixels((x,y)=>statePixel(raw,tileSize,state,Math.max(0,Math.min(tileSize-1,Math.floor(x))),Math.max(0,Math.min(tileSize-1,Math.floor(y)))),0,0,tileSize,tileSize);}
function imageDescriptor(image,x0,y0,x1,y1){return descriptorFromPixels((x,y)=>sampleImage(image,x,y),x0,y0,x1,y1);}
function similarity(a,b){let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=a[i]*b[i];return clamp((s+1)/2);}
function scanDescriptors(raw,tileSize,tileCount){const out=new Array(tileCount*4);for(let state=0;state<out.length;state++)out[state]=stateDescriptor(raw,tileSize,state);return out;}
function referenceDescriptors(faceImages,size){const out=[];for(let face=0;face<6;face++){const img=faceImages[face];for(let row=0;row<size;row++)for(let col=0;col<size;col++)out.push(imageDescriptor(img,col*img.width/size,row*img.height/size,(col+1)*img.width/size,(row+1)*img.height/size));}return out;}
function transformFacelet(index,size,m){const area=size*size,face=Math.floor(index/area),local=index%area,row=Math.floor(local/size),col=local%size,shell=size-1,pos=add(mul(FACE_NORMAL[face],shell),add(mul(FACE_RIGHT[face],2*col-shell),mul(FACE_UP[face],shell-2*row))),normal=matVec(m,FACE_NORMAL[face]),moved=matVec(m,pos),tf=faceForNormal(normal),tc=Math.round((dot(moved,FACE_RIGHT[tf])+shell)/2),tr=Math.round((shell-dot(moved,FACE_UP[tf]))/2);return tf*area+tr*size+tc;}
function rotateDescriptors(desc,size,m){const out=new Array(desc.length);for(let i=0;i<desc.length;i++)out[transformFacelet(i,size,m)]=desc[i];return out;}

function alignReference(scan,reference,size){
  if(size%2===0)return reference;
  const mid=Math.floor(size/2),area=size*size;let best=reference,bestScore=-Infinity;
  for(const m of CUBE_ROTATIONS){const candidate=rotateDescriptors(reference,size,m);let score=0;for(let face=0;face<6;face++){const tile=face*area+mid*size+mid;let local=0;for(let rot=0;rot<4;rot++)local=Math.max(local,similarity(scan[tile*4+rot],candidate[tile]));score+=local;}if(score>bestScore){bestScore=score;best=candidate;}}
  return best;
}

function centreOrientationScore(scan,reference,size){
  if(size%2===0)return 0;
  const mid=Math.floor(size/2),area=size*size;let total=0;
  for(let face=0;face<6;face++){
    const tile=face*area+mid*size+mid,target=tile;let best=0;
    for(let rot=0;rot<4;rot++)best=Math.max(best,similarity(scan[tile*4+rot],reference[target]));
    total+=best;
  }
  return total/6;
}

async function refineEquirectangularOrientation(image,scan,size){
  if(size%2===0)return null;
  const coarse=[];
  const deg=Math.PI/180;
  let done=0,total=12*5*6;
  for(let yaw=0;yaw<360;yaw+=30)for(let pitch=-60;pitch<=60;pitch+=30)for(let roll=0;roll<360;roll+=60){
    const orientation={yaw:yaw*deg,pitch:pitch*deg,roll:roll*deg};
    const faces=projectEquirectangular(image,36,orientation),reference=referenceDescriptors(faces,size),score=centreOrientationScore(scan,reference,size);
    coarse.push({orientation,score});
    done++;
    if(done%36===0)status("reference-orientation","Aligning spherical reference to fixed centres…",.36+.08*(done/total));
  }
  coarse.sort((a,b)=>b.score-a.score);
  let best=coarse[0]||{orientation:{yaw:0,pitch:0,roll:0},score:0};
  const seeds=coarse.slice(0,3),offsets=[-15,-7.5,0,7.5,15];
  let refinedDone=0,refinedTotal=seeds.length*offsets.length**3;
  for(const seed of seeds)for(const dy of offsets)for(const dp of offsets)for(const dr of offsets){
    const orientation={yaw:seed.orientation.yaw+dy*deg,pitch:clamp(seed.orientation.pitch+dp*deg,-Math.PI/2,Math.PI/2),roll:seed.orientation.roll+dr*deg};
    const faces=projectEquirectangular(image,48,orientation),reference=referenceDescriptors(faces,size),score=centreOrientationScore(scan,reference,size);
    if(score>best.score)best={orientation,score};
    refinedDone++;
    if(refinedDone%75===0)status("reference-orientation","Refining globe orientation…",.44+.06*(refinedDone/refinedTotal));
  }
  return best;
}

function hungarianMax(matrix){
  const n=matrix.length,u=new Float64Array(n+1),v=new Float64Array(n+1),p=new Int32Array(n+1),way=new Int32Array(n+1);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const minv=new Float64Array(n+1);minv.fill(Infinity);const used=new Uint8Array(n+1);
    do{used[j0]=1;const i0=p[j0];let delta=Infinity,j1=0;for(let j=1;j<=n;j++){if(used[j])continue;const cur=-matrix[i0-1][j-1]-u[i0]-v[j];if(cur<minv[j]){minv[j]=cur;way[j]=j0;}if(minv[j]<delta){delta=minv[j];j1=j;}}for(let j=0;j<=n;j++){if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else minv[j]-=delta;}j0=j1;}while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);
  }
  let score=0;const assignment=new Int32Array(n);assignment.fill(-1);
  for(let j=1;j<=n;j++)if(p[j]>0){score+=matrix[p[j]-1][j-1];assignment[p[j]-1]=j-1;}
  return{score,assignment};
}
function bytesToBase64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}

function buildEvidence(scan,size,reference){
  const tileCount=6*size*size,states=tileCount*4,aligned=alignReference(scan,reference,size),scores=new Float32Array(states*tileCount),matrix=Array.from({length:tileCount},()=>new Float64Array(tileCount));
  for(let tile=0;tile<tileCount;tile++)for(let target=0;target<tileCount;target++){
    let best=0;
    for(let rot=0;rot<4;rot++){const state=tile*4+rot,s=similarity(scan[state],aligned[target]);scores[state*tileCount+target]=s;if(s>best)best=s;}
    matrix[tile][target]=best;
  }
  const matching=hungarianMax(matrix),rawFit=matching.score/tileCount;
  let distinctiveness=0;
  for(let tile=0;tile<tileCount;tile++){
    const row=Array.from(matrix[tile]),assigned=matching.assignment[tile]>=0?row[matching.assignment[tile]]:0,ordered=[...row].sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length/2)],best=ordered[ordered.length-1],spread=Math.max(0,best-median),reliability=clamp((spread-.012)/.11),rank=row.filter(v=>v<assigned).length/Math.max(1,row.length-1);
    distinctiveness+=reliability*clamp((rank-.45)/.55);
  }
  distinctiveness/=tileCount;
  const fit=clamp(rawFit*(.38+.62*distinctiveness));
  return{version:1,states,targets:tileCount,absolute_f32_b64:bytesToBase64(new Uint8Array(scores.buffer)),fit,raw_fit:rawFit,distinctiveness};
}

async function facePreview(image){
  const res=112,source=new OffscreenCanvas(image.width,image.height),sourceCtx=source.getContext("2d",{alpha:false});sourceCtx.putImageData(image,0,0);
  const scaled=new OffscreenCanvas(res,res),ctx=scaled.getContext("2d",{alpha:false});ctx.drawImage(source,0,0,image.width,image.height,0,0,res,res);
  const blob=await scaled.convertToBlob({type:"image/jpeg",quality:.76}),bytes=new Uint8Array(await blob.arrayBuffer());return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

async function scoreCandidate(candidate,raw,tileSize,size,scan){
  try{
    const image=await imageDataFromUrl(candidate.thumbnailUrl),net=detectCubeNet(image);let faces=null,layout="",orientation=null;
    if(net){faces=projectCubeNet(image,net);layout=`${net.cols}×${net.rows} cube net`;}
    else if(image.width/image.height>1.72&&image.width/image.height<2.28){
      const refined=await refineEquirectangularOrientation(image,scan,size);orientation=refined?.orientation||null;faces=projectEquirectangular(image,192,orientation);layout=orientation?"equirectangular → 6 faces · spherical orientation fitted":"equirectangular → 6 faces";
    }
    if(!faces)return{...candidate,usable:false,reason:"No cube-net or equirectangular projection detected"};
    const descriptors=referenceDescriptors(faces,size),evidence=buildEvidence(scan,size,descriptors),facePreviews=[];for(const face of faces)facePreviews.push(await facePreview(face));
    return{...candidate,usable:true,fit:evidence.fit,rawFit:evidence.raw_fit,distinctiveness:evidence.distinctiveness,layout,evidence,facePreviews};
  }catch(error){return{...candidate,usable:false,reason:String(error?.message||error)};}
}

async function analyse(data){
  const raw=new Uint8Array(data.rawBuffer),tileSize=Number(data.tileSize||48),size=Number(data.size||3),tileCount=6*size*size,scan=scanDescriptors(raw,tileSize,tileCount);let subject=String(data.subject||"").trim(),recognition={faces:[],aggregate:[],model:null};
  if(!subject){try{recognition=await recogniseFaces(raw,tileSize,size);subject=recognition.subject;}catch(error){subject="picture artwork";postMessage({type:"reference-warning",message:`Artwork recognition unavailable: ${error?.message||error}`});}}
  else recognition={subject,faces:[],aggregate:[],model:null};
  status("search",`Looking for six-face references for “${subject}”…`,.18);const candidates=await searchReferences(subject,recognition.faces),ranked=candidates.slice(0,9),scored=[];
  for(let i=0;i<ranked.length;i++){status("reference",`Deriving and fitting reference ${i+1} of ${ranked.length}…`,.32+.64*((i+.25)/Math.max(1,ranked.length)));scored.push(await scoreCandidate(ranked[i],raw,tileSize,size,scan));}
  scored.sort((a,b)=>a.usable!==b.usable?(a.usable?-1:1):a.usable&&b.usable&&b.fit!==a.fit?b.fit-a.fit:b.searchPriority-a.searchPriority);const selectedIndex=scored.findIndex(x=>x.usable);
  status("complete",selectedIndex>=0?"Six-face reference ready":"No usable six-face reference found",1);
  postMessage({type:"reference-result",subject,faceRecognitions:recognition.faces||[],guesses:recognition.aggregate||[],model:recognition.model||null,candidates:scored,selectedIndex});
}

self.addEventListener("message",async event=>{try{if(event.data?.type!=="analyse")throw new Error(`Unknown reference worker message: ${event.data?.type}`);await analyse(event.data);}catch(error){postMessage({type:"reference-error",message:error instanceof Error?error.message:String(error)});}});
