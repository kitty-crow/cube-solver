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
const frontLocal={yaw:1.1,pitch:-.7,roll:.8};
const rightLocal={yaw:-.9,pitch:.6,roll:-.75};
const sf=residualSafety(extreme,frontLocal,global);
const sr=residualSafety(extreme,rightLocal,global);
assert.ok(sf>=0&&sf<=1);
assert.ok(sr>=0&&sr<=1);
assert.ok(sf<1||sr<1,"extreme edits should be attenuated rather than edge-clamped");

// F right edge and R left edge are the same physical cube seam. Local edits are
// allowed to refine interiors, but the seam itself must remain exactly shared.
for(let i=0;i<=16;i++){
  const v=i/16;
  const f=faceDirection(2,1,v,global,extreme,frontLocal,sf);
  const r=faceDirection(1,0,v,global,extreme,rightLocal,sr);
  assertVecNear(f,r,1e-9);
}

// Even pathological residuals are uniformly reduced until every sampled point
// remains inside its original face domain. No individual pixel gets clamped to
// the edge, which is what previously produced visible stretching.
for(let y=0;y<=24;y++)for(let x=0;x<=24;x++){
  const p=mapFacePoint(x/24,y/24,extreme,frontLocal,global,sf);
  assert.ok(p[0]>=-1e-9&&p[0]<=1+1e-9,`u out of domain: ${p[0]}`);
  assert.ok(p[1]>=-1e-9&&p[1]<=1+1e-9,`v out of domain: ${p[1]}`);
}

// With no residual, the mapping is identity and therefore all six face domains
// are just views into one rigid cube wrap.
const empty=blankWarp();
for(const p of [[0,0],[.5,.5],[1,1],[.2,.8]]){
  assert.deepEqual(mapFacePoint(p[0],p[1],empty,global,global,1),p);
}

console.log("connected cube-surface topology tests passed");
