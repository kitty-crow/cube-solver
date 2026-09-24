import assert from "node:assert/strict";
import {
  blankWarp, faceDirection, mapFacePoint, residualSafety,
} from "../web/cube-surface-map.js";

const near=(a,b,eps=1e-9)=>Math.abs(a-b)<=eps;

function assertVecNear(a,b,eps=1e-9){
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++)assert.ok(near(a[i],b[i],eps),`component ${i}: ${a[i]} != ${b[i]}`);
}

const global={yaw:.61,pitch:-.28,roll:.19};
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
assert.ok(safeties.every(value=>value>=0&&value<=1));
assert.ok(safeties.some(value=>value<1),"extreme edits should be attenuated rather than edge-clamped");

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

// Every physical edge is one mathematical seam, even when each adjacent face
// has a different local residual. A correction on one face cannot detach it from
// its neighbour or sample a second copy of some unrelated source patch.
for(const[aFace,aEdge,bFace,bEdge,reverse]of seams){
  for(let i=0;i<=20;i++){
    const t=i/20,[au,av]=edgePoint(aEdge,t),[bu,bv]=edgePoint(bEdge,reverse?1-t:t);
    const a=faceDirection(aFace,au,av,global,extreme,locals[aFace],safeties[aFace]);
    const b=faceDirection(bFace,bu,bv,global,extreme,locals[bFace],safeties[bFace]);
    assertVecNear(a,b,1e-9);
  }
}

// Even pathological residuals are uniformly reduced until every sampled point
// remains inside its original face domain. No individual pixel gets clamped to
// an edge, which is what previously produced visible stretching.
for(let face=0;face<6;face++)for(let y=0;y<=24;y++)for(let x=0;x<=24;x++){
  const p=mapFacePoint(x/24,y/24,extreme,locals[face],global,safeties[face]);
  assert.ok(p[0]>=-1e-9&&p[0]<=1+1e-9,`face ${face} u out of domain: ${p[0]}`);
  assert.ok(p[1]>=-1e-9&&p[1]<=1+1e-9,`face ${face} v out of domain: ${p[1]}`);
}

// With no residual, the mapping is identity and therefore all six face domains
// are just views into one rigid cube wrap.
const empty=blankWarp();
for(const p of [[0,0],[.5,.5],[1,1],[.2,.8]]){
  assertVecNear(mapFacePoint(p[0],p[1],empty,global,global,1),p,1e-12);
}

console.log("connected cube-surface topology tests passed");
