import assert from "node:assert/strict";
import { analyseStickerConstraints, EDGE_FACELETS, CORNER_FACELETS, CENTRE_FACELETS } from "../web/sticker-constraints.js";

const solvedState="UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

{
  const result=analyseStickerConstraints();
  assert.equal(result.ok,true);
  assert.ok(result.legalStateCount>1);
  assert.equal(result.confirmedCount,0);
  assert.equal(result.unresolvedCount,48);
}

{
  // One correctly oriented sticker from every movable cubie is enough to
  // identify the solved state. This proves the interaction is not a 48-item
  // questionnaire: cube mechanics propagate the remaining stickers.
  const confirmations={};
  for(const piece of EDGE_FACELETS)confirmations[piece[0]]={target:piece[0],rotation:0};
  for(const piece of CORNER_FACELETS)confirmations[piece[0]]={target:piece[0],rotation:0};
  const result=analyseStickerConstraints({confirmations,centerRotations:[0,0,0,0,0,0]});
  assert.equal(result.ok,true);
  assert.equal(result.legalStateCount,1);
  assert.ok(result.resolved);
  assert.equal(result.resolved.state,solvedState);
  assert.equal(result.confirmedCount,20);
  assert.equal(result.inferredCount,28);
  assert.equal(result.unresolvedCount,0);
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

console.log("sticker constraint tests passed");
