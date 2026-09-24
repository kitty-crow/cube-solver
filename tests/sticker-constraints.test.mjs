import assert from "node:assert/strict";
import { analyseStickerConstraints, EDGE_FACELETS, CORNER_FACELETS, CENTRE_FACELETS } from "../web/sticker-constraints-v2.js";

const solvedState="UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

function identityScoreMatrix(){
  const scores=new Float32Array(54*4*54);
  for(let tile=0;tile<54;tile++)for(let rotation=0;rotation<4;rotation++)for(let target=0;target<54;target++){
    const index=(tile*4+rotation)*54+target;
    scores[index]=tile===target&&rotation===0?1:0.05;
  }
  return Buffer.from(scores.buffer).toString("base64");
}

{
  const result=analyseStickerConstraints();
  assert.equal(result.ok,true);
  assert.ok(result.legalStateCount>1);
  assert.equal(result.confirmedCount,0);
  assert.equal(result.unresolvedCount,48);
  assert.equal(result.resolved,null);
}

{
  const confirmations={};
  for(const piece of EDGE_FACELETS)confirmations[piece[0]]={target:piece[0],rotation:0};
  for(const piece of CORNER_FACELETS)confirmations[piece[0]]={target:piece[0],rotation:0};
  const result=analyseStickerConstraints({confirmations,centerRotations:[0,0,0,0,0,0]});
  assert.equal(result.ok,true);
  assert.equal(result.legalStateCount,1);
  assert.ok(result.resolved);
  assert.equal(result.resolved.state,solvedState);
  assert.equal(result.resolved.exact,true);
  assert.equal(result.confirmedCount,20);
  assert.equal(result.inferredCount,28);
}

{
  const confirmations={};
  for(let tile=0;tile<54;tile++){
    if(CENTRE_FACELETS.includes(tile))continue;
    confirmations[tile]={target:tile,rotation:0};
  }
  const result=analyseStickerConstraints({confirmations,centerRotations:[0,0,0,0,0,0]});
  assert.equal(result.ok,true);
  assert.equal(result.legalStateCount,1);
  assert.equal(result.resolved.state,solvedState);
}

{
  const result=analyseStickerConstraints({confirmations:{5:{target:5,rotation:0},10:{target:5,rotation:0}}});
  assert.equal(result.ok,false);
  assert.equal(result.legalStateCount,0);
  assert.match(result.conflict,/already assigned/i);
}

{
  // Ambiguous answers are deliberately soft. Six 50% human hints, combined
  // with a strongly coherent image prior and exact cube mechanics, may make a
  // best legal state confident enough to solve without forcing uniqueness.
  const ambiguities={};
  for(const tile of[5,7,3,8,6,0])ambiguities[tile]={target:tile,rotation:0,weight:.5};
  const result=analyseStickerConstraints({ambiguities,absoluteF32B64:identityScoreMatrix(),centerRotations:[0,0,0,0,0,0]});
  assert.equal(result.ok,true);
  assert.ok(result.legalStateCount>1);
  assert.equal(result.ambiguousCount,6);
  assert.ok(result.stateConfidence>0.93);
  assert.ok(result.resolved);
  assert.equal(result.resolved.exact,false);
  assert.equal(result.resolved.resolution_kind,"probable");
  assert.equal(result.resolved.state,solvedState);
}

console.log("sticker constraint tests passed");
