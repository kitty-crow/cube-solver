import assert from "node:assert/strict";
import {
  blankWarp, cloneOrientation, cubeSurfaceAddress, faceDirection, mapFacePoint,
  normaliseSphericalAngles, residualSafety,
} from "../web/cube-surface-map.js";

const near=(a,b,eps=1e-9)=>Math.abs(a-b)<=eps;
function assertVecNear(a,b,eps=1e-9){
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++)assert.ok(near(a[i],b[i],eps),`component ${i}: ${a[i]} != ${b[i]}`);
}

const global={yaw:.61,pitch:-.28,roll:.19,scale:1.7};
const extreme={points:Array.from({length:9},(_,i)=>[
  i%2===0?.44:-.44,
  i%3===0?-.44:.44,
])};
const locals=[
  {yaw:.95,pitch:-.55,roll:.72},
  {yaw:-.9,pitch:.6,roll:-.75},
  {yaw:1.1,pitch:-.7,roll:.8},
  {yaw:-1.0,pitch:.5,roll:.66},
  {yaw:.82,pitch:.63,roll:-.7},
  {yaw:-.76,pitch:-.64,roll:.73},
];

const safeties=locals.map(local=>residualSafety(extreme,local,global));
assert.deepEqual(safeties,[1,1,1,1,1,1]);

const edgePoint=(edge,t)=>{
  if(edge==="L")return[0,t];
  if(edge==="R")return[1,t];
  if(edge==="T")return[t,0];
  return[t,1];
};
const seams=[
  [0,"L",4,"T",false],[0,"R",1,"T",true],[0,"T",5,"T",true],[0,"B",2,"T",false],
  [1,"L",2,"R",false],[1,"R",5,"L",false],[1,"B",3,"R",false],
  [2,"L",4,"R",false],[2,"B",3,"T",false],
  [3,"L",4,"B",true],[3,"B",5,"B",true],
  [4,"L",5,"R",false],
];

// Every physical cube edge remains exactly one seam.
for(const[aFace,aEdge,bFace,bEdge,reverse]of seams){
  for(let i=0;i<=20;i++){
    const t=i/20,[au,av]=edgePoint(aEdge,t),[bu,bv]=edgePoint(bEdge,reverse?1-t:t);
    const a=faceDirection(aFace,au,av,global,extreme,locals[aFace],1);
    const b=faceDirection(bFace,bu,bv,global,extreme,locals[bFace],1);
    assertVecNear(a,b,1e-9);
  }
}

// Crossing a face edge must FOLD onto the physical neighbouring face. It must
// not continue on the infinite tangent plane of the original face, because
// that old projection approaches a 90° horizon asymptotically and smears.
const frontAcrossRight=cubeSurfaceAddress(2,1.2,.4);
assert.equal(frontAcrossRight.face,1,"Front right edge should continue onto Right");
assert.ok(near(frontAcrossRight.u,.2));
assert.ok(near(frontAcrossRight.v,.4));
assertVecNear(
  faceDirection(2,1.2,.4,{yaw:0,pitch:0,roll:0,scale:1}),
  faceDirection(1,.2,.4,{yaw:0,pitch:0,roll:0,scale:1}),
  1e-12,
);

// Large movements may cross several faces and must always terminate on an
// actual finite cube face coordinate, never at a face-local horizon.
for(const sample of [
  [2,3.4,.35],
  [2,-2.8,.65],
  [0,.3,-3.2],
  [3,.8,4.1],
  [1,5.5,-2.25],
]){
  const address=cubeSurfaceAddress(...sample);
  assert.ok(address.face>=0&&address.face<6);
  assert.ok(address.u>=-1e-9&&address.u<=1+1e-9,`u did not fold to a cube face: ${address.u}`);
  assert.ok(address.v>=-1e-9&&address.v<=1+1e-9,`v did not fold to a cube face: ${address.v}`);
  assert.ok(address.steps>0,"large crossing should traverse at least one seam");
}

// A strong residual may request information beyond its starting face. The raw
// residual is not clamped, and faceDirection subsequently continues it over the
// cube topology rather than stretching the edge pixels.
const translated={points:Array.from({length:9},()=>[.45,0])};
const crossed=mapFacePoint(.35,.5,translated,global,global,1);
assert.ok(crossed[0]<0,"full-source mapping should cross the starting face boundary");
const folded=cubeSurfaceAddress(2,crossed[0],crossed[1]);
assert.notEqual(folded.face,2,"crossed residual should continue onto a neighbouring cube face");

// With no residual, the six domains remain ordinary views into one rigid wrap.
const empty=blankWarp();
for(const p of [[0,0],[.5,.5],[1,1],[.2,.8]]){
  assertVecNear(mapFacePoint(p[0],p[1],empty,global,global,1),p,1e-12);
}

// Manual cube pitch is an accumulated rotation, not a latitude coordinate. It
// may pass 90°, 180°, 360° and any further turn without being clamped/folded.
for(const turns of [100,181,360,721,-100,-541]){
  const radians=turns*Math.PI/180;
  const orientation=cloneOrientation({yaw:0,pitch:radians,roll:0});
  assert.equal(orientation.pitch,radians);
}

// Source-scale spherical coordinate handling still crosses poles rather than
// pinning to the top/bottom image row.
const[lon,lat]=normaliseSphericalAngles(.2,Math.PI*.75);
assert.ok(lat<=Math.PI/2&&lat>=-Math.PI/2);
assert.ok(!near(lon,.2),"pole crossing should continue onto the opposite longitude");

console.log("connected cross-face cube topology tests passed");
