import assert from "node:assert/strict";
import {
  blankWarp, cloneOrientation, faceDirection, mapFacePoint,
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

// Local refinement is never stopped just because it crosses a face's old 2D
// domain. The full source remains available, while seams are protected by the
// zero-at-edge residual envelope.
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

// Every physical cube edge remains exactly one seam, even under aggressive
// local interior refinements and a global source scale.
for(const[aFace,aEdge,bFace,bEdge,reverse]of seams){
  for(let i=0;i<=20;i++){
    const t=i/20,[au,av]=edgePoint(aEdge,t),[bu,bv]=edgePoint(bEdge,reverse?1-t:t);
    const a=faceDirection(aFace,au,av,global,extreme,locals[aFace],1);
    const b=faceDirection(bFace,bu,bv,global,extreme,locals[bFace],1);
    assertVecNear(a,b,1e-9);
  }
}

// A strong residual is allowed to ask for source information beyond the old
// selected-face box instead of pinning to its edge and smearing the last pixels.
const translated={points:Array.from({length:9},()=>[.45,0])};
const crossed=mapFacePoint(.35,.5,translated,global,global,1);
assert.ok(crossed[0]<0,"full-source mapping should cross the old face boundary instead of clamping there");

// With no residual, the six domains remain ordinary views into one rigid wrap.
const empty=blankWarp();
for(const p of [[0,0],[.5,.5],[1,1],[.2,.8]]){
  assertVecNear(mapFacePoint(p[0],p[1],empty,global,global,1),p,1e-12);
}

// Manual cube rotation must not have a ±90° pitch wall.
const multiTurn=cloneOrientation({yaw:0,pitch:Math.PI*5,roll:0});
assert.equal(multiTurn.pitch,Math.PI*5);

// Scaling or continued vertical movement through a pole reflects across the
// pole and advances longitude instead of repeating a single edge row.
const[lon,lat]=normaliseSphericalAngles(.2,Math.PI*.75);
assert.ok(lat<=Math.PI/2&&lat>=-Math.PI/2);
assert.ok(!near(lon,.2),"pole crossing should continue onto the opposite longitude");

console.log("connected full-source cube topology tests passed");
