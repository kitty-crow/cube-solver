export const FACE_NAMES=["U","R","F","D","L","B"];
export const FACE_NORMAL=[[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
export const FACE_RIGHT=[[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
export const FACE_UP=[[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];

const TAU=Math.PI*2;
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const normalise=(v)=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};

export function cloneOrientation(value={}){
  return{yaw:Number(value?.yaw||0),pitch:clamp(Number(value?.pitch||0),-Math.PI/2,Math.PI/2),roll:Number(value?.roll||0)};
}

export function angleDelta(value,base){
  let d=(Number(value||0)-Number(base||0))%TAU;
  if(d>Math.PI)d-=TAU;
  if(d< -Math.PI)d+=TAU;
  return d;
}

export function rotateContinuous(v,yaw=0,pitch=0,roll=0){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  let[x,y,z]=v;
  [x,z]=[cy*x+sy*z,-sy*x+cy*z];
  [y,z]=[cp*y-sp*z,sp*y+cp*z];
  [x,y]=[cr*x-sr*y,sr*x+cr*y];
  return[x,y,z];
}

export function blankWarp(){return{points:Array.from({length:9},()=>[0,0])};}

export function normaliseWarp(warp){
  const points=Array.isArray(warp?.points)?warp.points:[];
  return{points:Array.from({length:9},(_,i)=>{
    const p=points[i]||[0,0];
    return[clamp(Number(p[0])||0,-.45,.45),clamp(Number(p[1])||0,-.45,.45)];
  })};
}

function warpDisplacement(warp,u,v){
  const points=warp?.points?.length===9?warp.points:normaliseWarp(warp).points;
  const gx=clamp(u*2,0,2),gy=clamp(v*2,0,2),cx=Math.min(1,Math.floor(gx)),cy=Math.min(1,Math.floor(gy)),tx=gx-cx,ty=gy-cy;
  const at=(x,y)=>points[y*3+x],p00=at(cx,cy),p10=at(cx+1,cy),p01=at(cx,cy+1),p11=at(cx+1,cy+1),lerp=(a,b,t)=>a+(b-a)*t;
  return[lerp(lerp(p00[0],p10[0],tx),lerp(p01[0],p11[0],tx),ty),lerp(lerp(p00[1],p10[1],tx),lerp(p01[1],p11[1],tx),ty)];
}

// Local refinement is a residual over the one global cube wrap. The envelope is
// exactly zero on every cube edge, so adjacent faces always share the same seam.
function edgeEnvelope(u,v){
  const su=Math.sin(Math.PI*clamp(u)),sv=Math.sin(Math.PI*clamp(v));
  return su*su*sv*sv;
}

function intendedPoint(u,v,warp,effective,global){
  const envelope=edgeEnvelope(u,v),[dx,dy]=warpDisplacement(warp,u,v);
  let x=u-dx*envelope-.5,y=v-dy*envelope-.5;
  const localYaw=clamp(angleDelta(effective?.yaw,global?.yaw),-.70,.70);
  const localPitch=clamp(Number(effective?.pitch||0)-Number(global?.pitch||0),-.70,.70);
  const localRoll=clamp(angleDelta(effective?.roll,global?.roll),-.90,.90);

  // Yaw/pitch/roll are local residuals within this face, not independent cameras.
  // They decay to zero at the seam, preserving the topology of the cube surface.
  x-=localYaw/(Math.PI/2)*.42*envelope;
  y+=localPitch/(Math.PI/2)*.42*envelope;
  const a=-localRoll*envelope,c=Math.cos(a),s=Math.sin(a),rx=c*x-s*y,ry=s*x+c*y;
  return[rx+.5,ry+.5];
}

export function mapFacePoint(u,v,warp,effective,global,strength=1){
  const intended=intendedPoint(u,v,warp,effective,global),t=clamp(Number(strength)||0,0,1);
  return[u+(intended[0]-u)*t,v+(intended[1]-v)*t];
}

function cross2(a,b,c){return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}

function mappingValid(warp,effective,global,strength,steps=12){
  const grid=[];
  for(let y=0;y<=steps;y++){
    const row=[];
    for(let x=0;x<=steps;x++){
      const p=mapFacePoint(x/steps,y/steps,warp,effective,global,strength);
      if(p[0]<-1e-7||p[0]>1+1e-7||p[1]<-1e-7||p[1]>1+1e-7)return false;
      row.push(p);
    }
    grid.push(row);
  }
  const minArea=.08/(steps*steps);
  for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
    const p00=grid[y][x],p10=grid[y][x+1],p01=grid[y+1][x],p11=grid[y+1][x+1];
    if(cross2(p00,p10,p01)<=minArea||cross2(p10,p11,p01)<=minArea)return false;
  }
  return true;
}

// Reduce an over-aggressive local edit as one rigid residual amplitude. We never
// clamp individual pixels to an edge, which was the source of the old stretching.
export function residualSafety(warp,effective,global){
  if(mappingValid(warp,effective,global,1))return 1;
  let lo=0,hi=1;
  for(let i=0;i<14;i++){
    const mid=(lo+hi)/2;
    if(mappingValid(warp,effective,global,mid))lo=mid;else hi=mid;
  }
  return lo;
}

export function faceDirection(face,u,v,orientation,warp=blankWarp(),effective=orientation,strength=1){
  const mapped=mapFacePoint(u,v,warp,effective,orientation,strength),lu=2*mapped[0]-1,lv=1-2*mapped[1];
  let dir=normalise(add(FACE_NORMAL[face],add(mul(FACE_RIGHT[face],lu),mul(FACE_UP[face],lv))));
  const global=cloneOrientation(orientation);
  dir=rotateContinuous(dir,global.yaw,global.pitch,global.roll);
  return dir;
}

export function topologyMetadata(safeties={}){
  const values=FACE_NAMES.map(face=>Number(safeties[face]??1));
  return{
    surfacePartition:"connected-cube-surface",
    sourceOverlapAllowed:false,
    sourceOverlapFraction:0,
    seamPinned:true,
    faceDomainClippedFraction:0,
    noStretchClamping:true,
    minResidualAttenuation:values.length?Math.min(...values):1,
    faceResidualAttenuation:Object.fromEntries(FACE_NAMES.map(face=>[face,Number(safeties[face]??1)])),
  };
}
