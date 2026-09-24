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
  // Do not clamp pitch. A cube has no north/south editing wall: manual
  // translation/rotation must be able to continue through the poles forever.
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
  // Crucially, do NOT clamp this point back into the selected face. If the user
  // asks for more source image, let the ray continue into the full wrapped
  // reference. The previous face-domain clamp/attenuation is what produced the
  // visible streaking and the feeling that translation suddenly hit a wall.
  return[u+(intended[0]-u)*t,v+(intended[1]-v)*t];
}

// Kept for worker/API compatibility. Full-source resampling means a residual no
// longer needs to be attenuated merely because its interior crosses a face
// boundary. Shared seams are guaranteed by edgeEnvelope(), not by clipping.
export function residualSafety(){return 1;}

export function normaliseSphericalAngles(lon,lat){
  let x=Number(lon||0),y=Number(lat||0);
  // Crossing a pole continues onto the opposite longitude rather than pinning
  // to the first/last source row. This avoids polar row smearing under scaling.
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
  const global=cloneOrientation(orientation),mapped=mapFacePoint(u,v,warp,effective,global,strength),lu=2*mapped[0]-1,lv=1-2*mapped[1];
  let dir=normalise(add(FACE_NORMAL[face],add(mul(FACE_RIGHT[face],lu),mul(FACE_UP[face],lv))));
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
    minResidualAttenuation:1,
    faceResidualAttenuation:Object.fromEntries(FACE_NAMES.map(face=>[face,1])),
  };
}
