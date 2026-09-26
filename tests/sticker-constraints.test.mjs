import assert from "node:assert/strict";
import { analyseStickerConstraints, EDGE_FACELETS, CORNER_FACELETS, CENTRE_FACELETS } from "../web/sticker-constraints-v2.js";
import { compatibleReferenceTargets, prepareAuthoritativeOverride } from "../web/sticker-authoritative-override.js";

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
  // Ambiguous answers are deliberately soft. Twelve 50% human hints equal
  // six hard-confirmation equivalents for the automatic-confidence gate.
  const ambiguities={};
  const hintTiles=[5,7,3,1,32,28,8,6,0,2,29,27];
  for(const tile of hintTiles)ambiguities[tile]={target:tile,rotation:0,weight:.5};
  const result=analyseStickerConstraints({ambiguities,absoluteF32B64:identityScoreMatrix(),centerRotations:[0,0,0,0,0,0]});
  assert.equal(result.ok,true);
  assert.ok(result.legalStateCount>1);
  assert.equal(result.ambiguousCount,12);
  assert.ok(result.stateConfidence>0.93);
  assert.ok(result.resolved);
  assert.equal(result.resolved.exact,false);
  assert.equal(result.resolved.resolution_kind,"probable");
  assert.equal(result.resolved.state,solvedState);
}

{
  // Manual 100% overrides are not limited to the engine's current domain.
  // They can claim any reference sticker of the same physical type.
  const targets=compatibleReferenceTargets(7);
  assert.ok(targets.includes(7));
  assert.ok(targets.includes(19));
  assert.ok(!targets.includes(8));
  assert.ok(!targets.includes(4));
}

{
  // If the authoritative target cubie is already claimed elsewhere, release
  // that entire stale physical cubie and any stale sibling answer on the
  // overridden physical cubie before installing the new hard fact.
  const prepared=prepareAuthoritativeOverride({
    tile:7,target:7,rotation:0,
    confirmations:{
      7:{target:19,rotation:0},
      19:{target:7,rotation:0},
      5:{target:7,rotation:0},
      10:{target:19,rotation:0},
      3:{target:3,rotation:0},
    },
    ambiguities:{5:{target:7,rotation:0,weight:.5}},
  });
  assert.equal(prepared.ok,true);
  assert.deepEqual(prepared.confirmations[7],{target:7,rotation:0});
  assert.equal(prepared.confirmations[19],undefined);
  assert.equal(prepared.confirmations[5],undefined);
  assert.equal(prepared.confirmations[10],undefined);
  assert.deepEqual(prepared.confirmations[3],{target:3,rotation:0});
  assert.equal(prepared.ambiguities[5],undefined);
  const result=analyseStickerConstraints({confirmations:prepared.confirmations,ambiguities:prepared.ambiguities});
  assert.equal(result.ok,true);
  assert.ok(result.legalStateCount>0);
}

{
  const prepared=prepareAuthoritativeOverride({tile:7,target:8,rotation:0});
  assert.equal(prepared.ok,false);
  assert.match(prepared.message,/same cubie type/i);
}

console.log("sticker constraint tests passed");
