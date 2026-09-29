const NORMAL=[[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
const RIGHT=[[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
const UP=[[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const add=(a,b,c)=>[a[0]+b[0]+c[0],a[1]+b[1]+c[1],a[2]+b[2]+c[2]];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function foldCubeSurface(face,u,v){
  const direction=add(NORMAL[face],mul(RIGHT[face],u),mul(UP[face],v));
  let axis=0;
  if(Math.abs(direction[1])>Math.abs(direction[axis]))axis=1;
  if(Math.abs(direction[2])>Math.abs(direction[axis]))axis=2;
  let nextFace;
  if(axis===0)nextFace=direction[0]>=0?1:4;
  else if(axis===1)nextFace=direction[1]>=0?0:3;
  else nextFace=direction[2]>=0?2:5;
  const denom=Math.max(1e-9,dot(direction,NORMAL[nextFace]));
  return{face:nextFace,u:dot(direction,RIGHT[nextFace])/denom,v:dot(direction,UP[nextFace])/denom};
}

export function prepareFacePixels(images,resolution=256){
  return images.map(image=>{
    const canvas=document.createElement("canvas");
    canvas.width=resolution;canvas.height=resolution;
    const ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});
    ctx.drawImage(image,0,0,resolution,resolution);
    return ctx.getImageData(0,0,resolution,resolution);
  });
}

function sample(image,u,v,out,offset){
  const x=clamp((u+1)*.5*(image.width-1),0,image.width-1),y=clamp((1-v)*.5*(image.height-1),0,image.height-1);
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),fx=x-x0,fy=y-y0;
  for(let c=0;c<3;c++){
    const a=image.data[(y0*image.width+x0)*4+c]*(1-fx)+image.data[(y0*image.width+x1)*4+c]*fx;
    const b=image.data[(y1*image.width+x0)*4+c]*(1-fx)+image.data[(y1*image.width+x1)*4+c]*fx;
    out[offset+c]=Math.round(a*(1-fy)+b*fy);
  }
  out[offset+3]=255;
}

export function renderCubemapPan(canvas,facePixels,pan,quarterTurn=0){
  if(!canvas||!facePixels?.length||!pan)return;
  const ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true}),image=ctx.createImageData(canvas.width,canvas.height),w=canvas.width,h=canvas.height;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sx=((x+.5)/w-.5)*(2/3),sy=((y+.5)/h-.5)*(2/3);
    for(let q=0;q<((quarterTurn%4)+4)%4;q++)[sx,sy]=[sy,-sx];
    const point=foldCubeSurface(pan.face,pan.u+sx,pan.v-sy),face=facePixels[point.face];
    sample(face,point.u,point.v,image.data,(y*w+x)*4);
  }
  ctx.putImageData(image,0,0);
}
