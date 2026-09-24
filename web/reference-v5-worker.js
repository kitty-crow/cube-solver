const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const FACE_NORMAL = [[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
const FACE_RIGHT = [[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
const FACE_UP = [[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];

function status(stage, detail, progress) {
  postMessage({ type: "reference-status", stage, detail, progress });
}
function clamp(v,a=0,b=1){ return Math.max(a,Math.min(b,v)); }
function add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function mul(a,k){ return [a[0]*k,a[1]*k,a[2]*k]; }
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function neg(a){ return [-a[0],-a[1],-a[2]]; }
function same(a,b){ return a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2]; }
function normalise(v){ const n=Math.hypot(...v)||1; return v.map(x=>x/n); }
function median(values){ const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2; }
function matVec(m,v){ return [m.x[0]*v[0]+m.y[0]*v[1]+m.z[0]*v[2],m.x[1]*v[0]+m.y[1]*v[1]+m.z[1]*v[2],m.x[2]*v[0]+m.y[2]*v[1]+m.z[2]*v[2]]; }
function invMatVec(m,v){ return [dot(m.x,v),dot(m.y,v),dot(m.z,v)]; }
function faceForNormal(n){ return FACE_NORMAL.findIndex(x=>same(x,n)); }
function wrapAngle(a){ const p=Math.PI*2; return ((a%p)+p)%p; }

function allCubeRotations(){
  const axes=[[1,0,0],[0,1,0],[0,0,1]],signed=axes.concat(axes.map(neg)),out=[];
  for(const x of signed) for(const y of signed){
    if(dot(x,y)!==0) continue;
    const z=cross(x,y), key=`${x}|${y}|${z}`;
    if(!out.some(r=>r.key===key)) out.push({key,x,y,z});
  }
  return out;
}
const CUBE_ROTATIONS=allCubeRotations();

function rotateContinuous(v,yaw,pitch,roll){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  let [x,y,z]=v;
  [x,z]=[cy*x+sy*z,-sy*x+cy*z];
  [y,z]=[cp*y-sp*z,sp*y+cp*z];
  [x,y]=[cr*x-sr*y,sr*x+cr*y];
  return [x,y,z];
}

function rawStatePixel(raw,tileSize,state,x,y){
  const tile=Math.floor(state/4),rot=state%4,n=tileSize;
  let ox=x,oy=y;
  if(rot===1){ox=y;oy=n-1-x;}
  else if(rot===2){ox=n-1-x;oy=n-1-y;}
  else if(rot===3){ox=n-1-y;oy=x;}
  const o=((tile*n*n)+oy*n+ox)*3;
  return [raw[o],raw[o+1],raw[o+2]];
}
function pixelStats([r,g,b]){
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  return {lum:(.2126*r+.7152*g+.0722*b)/255,sat:(max-min)/Math.max(1,max),max:max/255};
}
function glareLikelihood(raw,tileSize,state,x,y){
  const s=pixelStats(rawStatePixel(raw,tileSize,state,x,y));
  if(s.lum<.70||s.sat>.30) return 0;
  const lums=[];
  for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,-1],[-1,1],[1,1]]){
    const nx=clamp(x+dx,0,tileSize-1),ny=clamp(y+dy,0,tileSize-1);
    lums.push(pixelStats(rawStatePixel(raw,tileSize,state,nx,ny)).lum);
  }
  const local=median(lums),spike=clamp((s.lum-local-.08)/.22),white=clamp((.28-s.sat)/.28),clip=clamp((s.max-.94)/.06);
  return clamp(Math.max(spike*white,clip*white*.85));
}
function statePixel(raw,tileSize,state,x,y){
  const rgb=rawStatePixel(raw,tileSize,state,x,y),glare=glareLikelihood(raw,tileSize,state,x,y);
  if(glare<=.02) return rgb;
  const neighbours=[[],[],[]];
  for(const [dx,dy] of [[-3,0],[3,0],[0,-3],[0,3],[-2,-2],[2,-2],[-2,2],[2,2]]){
    const nx=clamp(x+dx,0,tileSize-1),ny=clamp(y+dy,0,tileSize-1),p=rawStatePixel(raw,tileSize,state,nx,ny);
    if(glareLikelihood(raw,tileSize,state,nx,ny)>.35) continue;
    for(let c=0;c<3;c++) neighbours[c].push(p[c]);
  }
  if(!neighbours[0].length) return rgb;
  const repaired=neighbours.map(median),blend=.92*glare;
  return rgb.map((v,c)=>v*(1-blend)+repaired[c]*blend);
}
function estimateGlareFraction(raw,tileSize,tileCount){
  let glare=0,count=0,step=Math.max(2,Math.floor(tileSize/10));
  for(let tile=0;tile<tileCount;tile++) for(let y=step;y<tileSize-step;y+=step) for(let x=step;x<tileSize-step;x+=step){
    glare+=glareLikelihood(raw,tileSize,tile*4,x,y);count++;
  }
  return count?glare/count:0;
}

async function imageDataFromUrl(url,maxSide=1024){
  const response=await fetch(url,{mode:"cors"});
  if(!response.ok) throw new Error(`Reference fetch ${response.status}`);
  const blob=await response.blob(),bitmap=await createImageBitmap(blob);
  try{
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,w,h);
    return ctx.getImageData(0,0,w,h);
  } finally { bitmap.close?.(); }
}
function sampleImage(image,x,y){
  let ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const {data,width,height}=image;
  ix=((ix%width)+width)%width;iy=Math.max(0,Math.min(height-1,iy));
  const ix1=(ix+1)%width,iy1=Math.min(height-1,iy+1),out=[0,0,0];
  for(let c=0;c<3;c++){
    const a=data[(iy*width+ix)*4+c]*(1-fx)+data[(iy*width+ix1)*4+c]*fx;
    const b=data[(iy1*width+ix)*4+c]*(1-fx)+data[(iy1*width+ix1)*4+c]*fx;
    out[c]=a*(1-fy)+b*fy;
  }
  return out;
}

function rotate90(vector,axis,quarters){
  let out=vector;
  for(let i=0;i<((quarters%4)+4)%4;i++) out=add(cross(axis,out),mul(axis,dot(axis,out)));
  return out;
}
function cellActivity(image,col,row,cols,rows){
  const {data,width,height}=image;let sr=0,sg=0,sb=0,s2=0,count=0;
  for(let y=0;y<10;y++) for(let x=0;x<10;x++){
    const px=Math.min(width-1,Math.floor((col+(x+.5)/10)*width/cols)),py=Math.min(height-1,Math.floor((row+(y+.5)/10)*height/rows)),o=(py*width+px)*4,r=data[o],g=data[o+1],b=data[o+2];
    sr+=r;sg+=g;sb+=b;s2+=r*r+g*g+b*b;count++;
  }
  const mr=sr/count,mg=sg/count,mb=sb/count;
  return Math.sqrt(Math.max(0,s2/count-(mr*mr+mg*mg+mb*mb)))+.04*(Math.max(mr,mg,mb)-Math.min(mr,mg,mb));
}
function combinations(values,k){
  const out=[];
  function walk(start,p){if(p.length===k){out.push(p.slice());return;}for(let i=start;i<=values.length-(k-p.length);i++){p.push(values[i]);walk(i+1,p);p.pop();}}
  walk(0,[]);return out;
}
function foldNet(cells){
  const occupied=new Set(cells.map(c=>`${c.col},${c.row}`)),orient=new Map(),first=cells[0];
  orient.set(`${first.col},${first.row}`,{n:[0,0,1],r:[1,0,0],u:[0,1,0]});
  const q=[first];
  while(q.length){
    const cell=q.shift(),o=orient.get(`${cell.col},${cell.row}`),ns=[[cell.col+1,cell.row,o.u,1],[cell.col-1,cell.row,o.u,-1],[cell.col,cell.row-1,o.r,-1],[cell.col,cell.row+1,o.r,1]];
    for(const [col,row,axis,turn] of ns){
      const k=`${col},${row}`;if(!occupied.has(k))continue;
      const n={n:rotate90(o.n,axis,turn),r:rotate90(o.r,axis,turn),u:rotate90(o.u,axis,turn)};
      if(orient.has(k)){const old=orient.get(k);if(!same(old.n,n.n)||!same(old.r,n.r)||!same(old.u,n.u))return null;}
      else{orient.set(k,n);q.push({col,row});}
    }
  }
  if(orient.size!==6||new Set([...orient.values()].map(o=>String(o.n))).size!==6)return null;
  return orient;
}
function detectCubeNet(image){
  const ratio=image.width/image.height,layouts=[];if(Math.abs(ratio-4/3)<.14)layouts.push([4,3]);if(Math.abs(ratio-3/4)<.14)layouts.push([3,4]);let best=null;
  for(const [cols,rows] of layouts){
    const cells=[];for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)cells.push({col,row,activity:cellActivity(image,col,row,cols,rows)});
    cells.sort((a,b)=>b.activity-a.activity);
    for(const chosen of combinations(cells.slice(0,Math.min(9,cells.length)),6)){
      const orientations=foldNet(chosen);if(!orientations)continue;
      const score=chosen.reduce((s,c)=>s+c.activity,0);if(!best||score>best.score)best={cols,rows,cells:chosen,orientations,score};
    }
  }
  return best;
}
function projectCubeNet(image,net,res=192){
  const faces=new Array(6),cw=image.width/net.cols,ch=image.height/net.rows;
  for(const cell of net.cells){
    const o=net.orientations.get(`${cell.col},${cell.row}`),face=faceForNormal(o.n),canvas=new OffscreenCanvas(res,res),ctx=canvas.getContext("2d",{alpha:false}),out=ctx.createImageData(res,res);
    for(let y=0;y<res;y++) for(let x=0;x<res;x++){
      const u=2*(x+.5)/res-1,v=1-2*(y+.5)/res,tangent=add(mul(FACE_RIGHT[face],u),mul(FACE_UP[face],v)),lu=dot(tangent,o.r),lv=dot(tangent,o.u),sx=(cell.col+(lu+1)/2)*cw,sy=(cell.row+(1-lv)/2)*ch,[r,g,b]=sampleImage(image,sx,sy),p=(y*res+x)*4;
      out.data[p]=r;out.data[p+1]=g;out.data[p+2]=b;out.data[p+3]=255;
    }
    ctx.putImageData(out,0,0);faces[face]=ctx.getImageData(0,0,res,res);
  }
  return faces.every(Boolean)?faces:null;
}
function projectEquirectangular(image,res=192,orientation=null){
  const faces=[],yaw=orientation?.yaw||0,pitch=orientation?.pitch||0,roll=orientation?.roll||0;
  for(let face=0;face<6;face++){
    const canvas=new OffscreenCanvas(res,res),ctx=canvas.getContext("2d",{alpha:false}),out=ctx.createImageData(res,res);
    for(let y=0;y<res;y++) for(let x=0;x<res;x++){
      const u=2*(x+.5)/res-1,v=1-2*(y+.5)/res;
      let dir=normalise(add(FACE_NORMAL[face],add(mul(FACE_RIGHT[face],u),mul(FACE_UP[face],v))));
      if(orientation)dir=rotateContinuous(dir,yaw,pitch,roll);
      const lon=Math.atan2(dir[0],dir[2]),lat=Math.asin(clamp(dir[1],-1,1)),sx=(lon/(2*Math.PI)+.5)*image.width,sy=(.5-lat/Math.PI)*image.height,[r,g,b]=sampleImage(image,sx,sy),o=(y*res+x)*4;
      out.data[o]=r;out.data[o+1]=g;out.data[o+2]=b;out.data[o+3]=255;
    }
    ctx.putImageData(out,0,0);faces.push(ctx.getImageData(0,0,res,res));
  }
  return faces;
}

function descriptorFromPixels(readPixel,x0,y0,x1,y1,side=10){
  const vals=new Float32Array(side*side*4);let mean=0,p=0;
  for(let y=0;y<side;y++) for(let x=0;x<side;x++){
    const sx=x0+(x+.5)*(x1-x0)/side,sy=y0+(y+.5)*(y1-y0)/side,[r,g,b]=readPixel(sx,sy),sum=r+g+b+1,lum=(.2126*r+.7152*g+.0722*b)/255;
    vals[p++]=r/sum;vals[p++]=g/sum;vals[p++]=b/sum;vals[p++]=lum;mean+=lum;
  }
  mean/=side*side;const out=[];
  for(let i=0;i<side*side;i++)out.push(vals[i*4]*.75,vals[i*4+1]*.75,vals[i*4+2]*.75,(vals[i*4+3]-mean)*.45);
  for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){const i=y*side+x;out.push((vals[(i+1)*4+3]-vals[(i-1)*4+3])*.75,(vals[(i+side)*4+3]-vals[(i-side)*4+3])*.75);}
  const n=Math.sqrt(out.reduce((s,v)=>s+v*v,0))||1;return Float32Array.from(out,v=>v/n);
}
function stateDescriptor(raw,tileSize,state){return descriptorFromPixels((x,y)=>statePixel(raw,tileSize,state,clamp(Math.floor(x),0,tileSize-1),clamp(Math.floor(y),0,tileSize-1)),0,0,tileSize,tileSize);}
function imageDescriptor(image,x0,y0,x1,y1){return descriptorFromPixels((x,y)=>sampleImage(image,x,y),x0,y0,x1,y1);}
function similarity(a,b){let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=a[i]*b[i];return clamp((s+1)/2);}
function scanDescriptors(raw,tileSize,tileCount){const out=new Array(tileCount*4);for(let state=0;state<out.length;state++)out[state]=stateDescriptor(raw,tileSize,state);return out;}
function referenceDescriptors(faceImages,size){const out=[];for(let face=0;face<6;face++){const img=faceImages[face];for(let row=0;row<size;row++)for(let col=0;col<size;col++)out.push(imageDescriptor(img,col*img.width/size,row*img.height/size,(col+1)*img.width/size,(row+1)*img.height/size));}return out;}

function transformFacelet(index,size,m){
  const area=size*size,face=Math.floor(index/area),local=index%area,row=Math.floor(local/size),col=local%size,shell=size-1;
  const pos=add(mul(FACE_NORMAL[face],shell),add(mul(FACE_RIGHT[face],2*col-shell),mul(FACE_UP[face],shell-2*row))),normal=matVec(m,FACE_NORMAL[face]),moved=matVec(m,pos),tf=faceForNormal(normal),tc=Math.round((dot(moved,FACE_RIGHT[tf])+shell)/2),tr=Math.round((shell-dot(moved,FACE_UP[tf]))/2);
  return tf*area+tr*size+tc;
}
function rotateDescriptors(desc,size,m){const out=new Array(desc.length);for(let i=0;i<desc.length;i++)out[transformFacelet(i,size,m)]=desc[i];return out;}
function rotateFaceImages(images,m){
  if(!m)return images;
  const out=new Array(6);
  for(let targetFace=0;targetFace<6;targetFace++){
    const sourceNormal=invMatVec(m,FACE_NORMAL[targetFace]),sourceFace=faceForNormal(sourceNormal),src=images[sourceFace],w=src.width,h=src.height,canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext("2d",{alpha:false}),dst=ctx.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=2*(x+.5)/w-1,v=1-2*(y+.5)/h,targetTangent=add(mul(FACE_RIGHT[targetFace],u),mul(FACE_UP[targetFace],v)),sourceTangent=invMatVec(m,targetTangent),su=dot(sourceTangent,FACE_RIGHT[sourceFace]),sv=dot(sourceTangent,FACE_UP[sourceFace]),sx=(su+1)*.5*w-.5,sy=(1-sv)*.5*h-.5,[r,g,b]=sampleImage(src,sx,sy),o=(y*w+x)*4;
      dst.data[o]=r;dst.data[o+1]=g;dst.data[o+2]=b;dst.data[o+3]=255;
    }
    ctx.putImageData(dst,0,0);out[targetFace]=dst;
  }
  return out;
}

function centreAnchorMetrics(scan,reference,size){
  if(size%2===0)return{score:0,mean:0,anchors:[]};
  const area=size*size,mid=Math.floor(size/2),anchors=[];let total=0;
  for(let face=0;face<6;face++){
    const tile=face*area+mid*size+mid,target=tile;let correct=-Infinity,bestRot=0;
    for(let rot=0;rot<4;rot++){const s=similarity(scan[tile*4+rot],reference[target]);if(s>correct){correct=s;bestRot=rot;}}
    let wrong=0;
    for(let other=0;other<6;other++){
      if(other===face)continue;
      const otherTarget=other*area+mid*size+mid;
      for(let rot=0;rot<4;rot++)wrong=Math.max(wrong,similarity(scan[tile*4+rot],reference[otherTarget]));
    }
    const margin=correct-wrong;
    total+=correct+.35*margin;
    anchors.push({target:FACE_NAMES[face],source:FACE_NAMES[face],score:correct,wrongScore:wrong,margin,scanRotation:bestRot});
  }
  return{score:total/6,mean:anchors.reduce((s,a)=>s+a.score,0)/6,margin:anchors.reduce((s,a)=>s+a.margin,0)/6,anchors};
}
function bestDiscreteAlignment(scan,reference,size){
  if(size%2===0)return{descriptors:reference,rotation:null,metrics:null};
  let best=null;
  for(const rotation of CUBE_ROTATIONS){
    const descriptors=rotateDescriptors(reference,size,rotation),metrics=centreAnchorMetrics(scan,descriptors,size);
    if(!best||metrics.score>best.metrics.score)best={descriptors,rotation,metrics};
  }
  return best;
}
async function fitEquirectangularOrientation(image,scan,size){
  if(size%2===0)return{orientation:null,metrics:null};
  const deg=Math.PI/180,coarse=[];let done=0,total=0;
  for(let yaw=0;yaw<360;yaw+=45)for(let pitch=-90;pitch<=90;pitch+=30)for(let roll=0;roll<360;roll+=45)total++;
  for(let yaw=0;yaw<360;yaw+=45)for(let pitch=-90;pitch<=90;pitch+=30)for(let roll=0;roll<360;roll+=45){
    const orientation={yaw:yaw*deg,pitch:pitch*deg,roll:roll*deg},faces=projectEquirectangular(image,30,orientation),reference=referenceDescriptors(faces,size),metrics=centreAnchorMetrics(scan,reference,size);
    coarse.push({orientation,metrics});done++;
    if(done%32===0)status("reference-orientation","Locking artwork to the six fixed centres…",.12+.34*(done/total));
  }
  coarse.sort((a,b)=>b.metrics.score-a.metrics.score);
  const steps=[15,7.5,3.75,1.875,.9375,.46875],seeds=coarse.slice(0,4),refined=[];let progress=0,totalRefine=seeds.length*steps.length*27;
  for(const seed of seeds){
    let current=seed;
    for(const step of steps){
      let local=current;
      for(const dy of [-step,0,step])for(const dp of [-step,0,step])for(const dr of [-step,0,step]){
        const orientation={yaw:wrapAngle(current.orientation.yaw+dy*deg),pitch:clamp(current.orientation.pitch+dp*deg,-Math.PI/2,Math.PI/2),roll:wrapAngle(current.orientation.roll+dr*deg)},faces=projectEquirectangular(image,42,orientation),reference=referenceDescriptors(faces,size),metrics=centreAnchorMetrics(scan,reference,size);
        if(metrics.score>local.metrics.score)local={orientation,metrics};
        progress++;if(progress%54===0)status("reference-orientation","Refining fixed-centre artwork alignment…",.46+.27*(progress/totalRefine));
      }
      current=local;
    }
    refined.push(current);
  }
  refined.sort((a,b)=>b.metrics.score-a.metrics.score);
  return refined[0]||coarse[0];
}

function hungarianMax(matrix){
  const n=matrix.length,u=new Float64Array(n+1),v=new Float64Array(n+1),p=new Int32Array(n+1),way=new Int32Array(n+1);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const minv=new Float64Array(n+1);minv.fill(Infinity);const used=new Uint8Array(n+1);
    do{
      used[j0]=1;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=n;j++){if(used[j])continue;const cur=-matrix[i0-1][j-1]-u[i0]-v[j];if(cur<minv[j]){minv[j]=cur;way[j]=j0;}if(minv[j]<delta){delta=minv[j];j1=j;}}
      for(let j=0;j<=n;j++){if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else minv[j]-=delta;}j0=j1;
    }while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);
  }
  const assignment=new Int32Array(n);assignment.fill(-1);
  for(let j=1;j<=n;j++)if(p[j]>0)assignment[p[j]-1]=j-1;
  return assignment;
}
function bytesToBase64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function buildEvidence(scan,size,reference,glareFraction=0){
  const tileCount=6*size*size,states=tileCount*4,scores=new Float32Array(states*tileCount),matrix=Array.from({length:tileCount},()=>new Float64Array(tileCount)),assignmentMatrix=Array.from({length:tileCount},()=>new Float64Array(tileCount));
  const odd=size%2===1,area=size*size,mid=Math.floor(size/2),centreLocal=mid*size+mid;
  const isCentre=index=>odd&&(index%area)===centreLocal;
  for(let tile=0;tile<tileCount;tile++)for(let target=0;target<tileCount;target++){
    const tileCentre=isCentre(tile),targetCentre=isCentre(target),sameCentre=tileCentre&&targetCentre&&Math.floor(tile/area)===Math.floor(target/area),allowed=!odd||(!tileCentre&&!targetCentre)||sameCentre;
    let best=0;
    for(let rot=0;rot<4;rot++){
      const state=tile*4+rot,s=allowed?similarity(scan[state],reference[target]):0;
      scores[state*tileCount+target]=s;if(s>best)best=s;
    }
    matrix[tile][target]=best;
    assignmentMatrix[tile][target]=best+(sameCentre?4:0);
  }
  const assignment=hungarianMax(assignmentMatrix);let rawFit=0,distinctiveness=0;
  for(let tile=0;tile<tileCount;tile++){
    const assigned=assignment[tile]>=0?matrix[tile][assignment[tile]]:0;rawFit+=assigned;
    const row=Array.from(matrix[tile]),ordered=[...row].sort((a,b)=>a-b),medianValue=ordered[Math.floor(ordered.length/2)],best=ordered[ordered.length-1],spread=Math.max(0,best-medianValue),reliability=clamp((spread-.010)/.10),rank=row.filter(v=>v<assigned).length/Math.max(1,row.length-1);
    distinctiveness+=reliability*clamp((rank-.42)/.58);
  }
  rawFit/=tileCount;distinctiveness/=tileCount;
  const fit=clamp(rawFit*(.42+.58*distinctiveness));
  return{version:2,states,targets:tileCount,absolute_f32_b64:bytesToBase64(new Uint8Array(scores.buffer)),fit,raw_fit:rawFit,distinctiveness,glare_fraction:glareFraction,hard_fixed_centres:odd};
}
async function facePreview(image){
  const res=112,source=new OffscreenCanvas(image.width,image.height),sctx=source.getContext("2d",{alpha:false});sctx.putImageData(image,0,0);
  const scaled=new OffscreenCanvas(res,res),ctx=scaled.getContext("2d",{alpha:false});ctx.drawImage(source,0,0,image.width,image.height,0,0,res,res);
  const blob=await scaled.convertToBlob({type:"image/jpeg",quality:.82}),bytes=new Uint8Array(await blob.arrayBuffer());return`data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

async function scoreCandidate(candidate,raw,tileSize,size){
  const tileCount=6*size*size,glareFraction=estimateGlareFraction(raw,tileSize,tileCount),scan=scanDescriptors(raw,tileSize,tileCount);
  if(glareFraction>.025)status("glare",`Suppressing specular glare (${Math.round(glareFraction*100)}% of sampled evidence)…`,.04);
  const image=await imageDataFromUrl(candidate.thumbnailUrl),net=detectCubeNet(image);let faces=null,layout="",alignment=null;
  if(net){
    status("reference","Unfolding selected cube net…",.10);
    const rawFaces=projectCubeNet(image,net);if(!rawFaces)throw new Error("Cube net could not be unfolded");
    if(size%2===1){
      const initial=referenceDescriptors(rawFaces,size),locked=bestDiscreteAlignment(scan,initial,size);
      faces=rotateFaceImages(rawFaces,locked.rotation);alignment={...locked.metrics,hardAnchored:true,kind:"fixed-centre discrete"};
    }else faces=rawFaces;
    layout=`${net.cols}×${net.rows} cube net · fixed-centre anchored`;
  }else if(image.width/image.height>1.72&&image.width/image.height<2.28){
    const fitted=await fitEquirectangularOrientation(image,scan,size);
    faces=projectEquirectangular(image,192,fitted?.orientation||null);
    alignment=fitted?.metrics?{...fitted.metrics,hardAnchored:size%2===1,kind:"fixed-centre spherical"}:null;
    layout=size%2===1?"equirectangular → 6 faces · fixed-centre spherical lock":"equirectangular → 6 faces";
  }else throw new Error("No cube-net or equirectangular projection detected");

  status("reference","Matching selected artwork to stickers…",.78);
  const descriptors=referenceDescriptors(faces,size),evidence=buildEvidence(scan,size,descriptors,glareFraction),facePreviews=[];
  for(const face of faces)facePreviews.push(await facePreview(face));
  return{...candidate,usable:true,fit:evidence.fit,rawFit:evidence.raw_fit,distinctiveness:evidence.distinctiveness,glareFraction,layout,evidence,facePreviews,alignment};
}

let searchWorker=null;
function ensureSearchWorker(){
  if(searchWorker)return searchWorker;
  searchWorker=new Worker(new URL("./reference-v4-worker.js",self.location.href),{type:"module"});
  searchWorker.addEventListener("message",event=>{
    const msg=event.data||{};postMessage(msg);
    if(msg.type==="reference-search-result"||msg.type==="reference-error"){
      searchWorker?.terminate?.();searchWorker=null;
    }
  });
  searchWorker.addEventListener("error",event=>{postMessage({type:"reference-error",message:event.message||"Reference search failed"});searchWorker?.terminate?.();searchWorker=null;});
  return searchWorker;
}

async function matchPhase(data){
  const raw=new Uint8Array(data.rawBuffer),tileSize=Number(data.tileSize||48),size=Number(data.size||3),candidate=data.candidate;
  if(!candidate?.thumbnailUrl)throw new Error("No reference image selected");
  status("match",`Matching ${String(candidate.title||"selected artwork").replace(/^File:/,"")}…`,.01);
  let scored;
  try{scored=await scoreCandidate(candidate,raw,tileSize,size);}catch(error){scored={...candidate,usable:false,reason:String(error?.message||error)};}
  status("complete",scored.usable?"Selected reference ready":"Selected reference could not be matched",1);
  postMessage({type:"reference-result",subject:String(data.subject||""),faceRecognitions:data.faceRecognitions||[],guesses:data.guesses||[],model:data.model||null,candidates:[scored],selectedIndex:scored.usable?0:-1});
}

self.addEventListener("message",async event=>{
  try{
    const data=event.data||{};
    if(data.type==="search"){
      const forwarded=new Uint8Array(data.rawBuffer);ensureSearchWorker().postMessage({...data,rawBuffer:forwarded.buffer},[forwarded.buffer]);
    }else if(data.type==="match")await matchPhase(data);
    else throw new Error(`Unknown reference worker message: ${data.type}`);
  }catch(error){postMessage({type:"reference-error",message:error instanceof Error?error.message:String(error)});}
});
