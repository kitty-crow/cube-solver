export const FACE_NAMES=["U","R","F","D","L","B"];
export const FACE_NORMAL=[[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];
export const FACE_RIGHT=[[1,0,0],[0,0,-1],[1,0,0],[1,0,0],[0,0,1],[-1,0,0]];
export const FACE_UP=[[0,0,-1],[0,1,0],[0,1,0],[0,0,1],[0,1,0],[0,1,0]];

const TAU=Math.PI*2;
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const normalise=(v)=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
const wrapSigned=(v)=>{let x=Number(v||0)%TAU;if(x>Math.PI)x-=TAU;if(x< -Math.PI)x+=TAU;return x;};

export function cloneOrientation(value={}){
  // Pitch is deliberately NOT clamped or folded. Manual cube rotation may make
  // any number of complete turns; the rotation matrix below remains periodic.
  return{
    yaw:Number(value?.yaw||0),
    pitch:Number(value?.pitch||0),
    roll:Number(value?.roll||0),
    scale:clamp(Number(value?.scale||value?.sourceScale||1),.05,20),
  };
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

// Local refinement is a residual over one global cube wrap. The envelope is
// exactly zero at all four edges, therefore adjacent faces remain the same
// mathematical surface even when their interiors are refined independently.
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

  // Legacy local orientation residuals remain readable for old saved mappings,
  // but they vanish at seams. New mappings keep face orientation equal to the
  // global cube orientation and use Warp only for deliberate local refinement.
  x-=localYaw/(Math.PI/2)*.42*envelope;
  y+=localPitch/(Math.PI/2)*.42*envelope;
  const a=-localRoll*envelope,c=Math.cos(a),s=Math.sin(a),rx=c*x-s*y,ry=s*x+c*y;
  return[rx+.5,ry+.5];
}

export function mapFacePoint(u,v,warp,effective,global,strength=1){
  const intended=intendedPoint(u,v,warp,effective,global),t=clamp(Number(strength)||0,0,1);
  return[u+(intended[0]-u)*t,v+(intended[1]-v)*t];
}

// The physical cube topology. These are the same twelve seam relations used by
// the topology regression test. `reverse` says whether the coordinate running
// along the seam is reversed on the neighbouring face.
const SEAMS=[
  [0,"L",4,"T",false],[0,"R",1,"T",true],[0,"T",5,"T",true],[0,"B",2,"T",false],
  [1,"L",2,"R",false],[1,"R",5,"L",false],[1,"B",3,"R",false],
  [2,"L",4,"R",false],[2,"B",3,"T",false],
  [3,"L",4,"B",true],[3,"B",5,"B",true],
  [4,"L",5,"R",false],
];
const EDGE_MAP=Array.from({length:6},()=>({}));
for(const[a,ae,b,be,reverse]of SEAMS){
  EDGE_MAP[a][ae]={face:b,edge:be,reverse};
  EDGE_MAP[b][be]={face:a,edge:ae,reverse};
}

function enterFromEdge(edge,t,depth){
  if(edge==="L")return[depth,t];
  if(edge==="R")return[1-depth,t];
  if(edge==="T")return[t,depth];
  return[t,1-depth];
}

/**
 * Continue arbitrary face-local coordinates over the ACTUAL cube surface.
 *
 * Earlier versions let u/v continue on the infinite plane of the selected
 * face. That plane approaches the face horizon asymptotically, so dragging or
 * warping towards an edge appeared to stop around 89° and many output pixels
 * collapsed onto the same narrow source strip (the visible "smearing").
 *
 * Here every time a coordinate crosses an edge we fold the excess 90° onto the
 * physically adjacent cube face, preserving the along-edge coordinate. Large
 * movements may cross any number of faces. There is therefore no horizon and
 * no face-local source edge to smear against.
 */
export function cubeSurfaceAddress(face,u,v,maxSteps=128){
  let f=Math.max(0,Math.min(5,Number(face)||0)),x=Number(u)||0,y=Number(v)||0;
  for(let step=0;step<maxSteps;step++){
    const violations=[];
    if(x<0)violations.push(["L",-x]);
    if(x>1)violations.push(["R",x-1]);
    if(y<0)violations.push(["T",-y]);
    if(y>1)violations.push(["B",y-1]);
    if(!violations.length)return{face:f,u:x,v:y,steps:step};
    violations.sort((a,b)=>b[1]-a[1]);
    const[edge,depth]=violations[0],transition=EDGE_MAP[f][edge];
    if(!transition)break;
    const along=(edge==="L"||edge==="R")?y:x;
    const t=transition.reverse?1-along:along;
    [x,y]=enterFromEdge(transition.edge,t,depth);
    f=transition.face;
  }
  // The step limit is purely defensive. Keep the returned coordinates finite;
  // normal interaction is many orders of magnitude below this path length.
  return{face:f,u:x,v:y,steps:maxSteps};
}

// Kept for worker/API compatibility. Seam continuity is now enforced by the
// cube-surface fold itself rather than by clipping or attenuating an edit.
export function residualSafety(){return 1;}

export function normaliseSphericalAngles(lon,lat){
  let x=Number(lon||0),y=Number(lat||0);
  while(y>Math.PI/2){y=Math.PI-y;x+=Math.PI;}
  while(y< -Math.PI/2){y=-Math.PI-y;x+=Math.PI;}
  return[wrapSigned(x),y];
}

function directionFromLonLat(lon,lat){
  const c=Math.cos(lat);
  return[Math.sin(lon)*c,Math.sin(lat),Math.cos(lon)*c];
}

function applyGlobalSourceScale(dir,scale){
  const s=clamp(Number(scale)||1,.05,20);
  if(Math.abs(s-1)<1e-12)return dir;
  const lon=Math.atan2(dir[0],dir[2]),lat=Math.asin(clamp(dir[1],-1,1));
  const[scaledLon,scaledLat]=normaliseSphericalAngles(lon/s,lat/s);
  return directionFromLonLat(scaledLon,scaledLat);
}

export function faceDirection(face,u,v,orientation,warp=blankWarp(),effective=orientation,strength=1){
  const global=cloneOrientation(orientation),mapped=mapFacePoint(u,v,warp,effective,global,strength),address=cubeSurfaceAddress(face,mapped[0],mapped[1]),lu=2*address.u-1,lv=1-2*address.v;
  let dir=normalise(add(FACE_NORMAL[address.face],add(mul(FACE_RIGHT[address.face],lu),mul(FACE_UP[address.face],lv))));
  dir=rotateContinuous(dir,global.yaw,global.pitch,global.roll);
  return applyGlobalSourceScale(dir,global.scale);
}

export function topologyMetadata(safeties={}){
  return{
    surfacePartition:"connected-cube-surface",
    sourceOverlapAllowed:false,
    sourceOverlapFraction:0,
    seamPinned:true,
    faceDomainClippedFraction:0,
    noStretchClamping:true,
    fullSourceResampling:true,
    unboundedInteriorSampling:true,
    crossFaceContinuation:true,
    infinitePlaneProjection:false,
    minResidualAttenuation:1,
    faceResidualAttenuation:Object.fromEntries(FACE_NAMES.map(face=>[face,1])),
  };
}
