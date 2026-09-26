import assert from "node:assert/strict";
import {analyseStickerConstraints} from "../web/sticker-constraints-v3.js";
import {
  buildTweakConstraints,
  candidateTargets,
  compatibleTarget,
  completeTweakTarget,
  pieceForTile,
  mod4,
} from "../web/post-solve-tweak-model.js";

assert.equal(pieceForTile(5)?.kind,"edge");
assert.deepEqual(pieceForTile(5)?.tiles,[5,10]);
assert.equal(pieceForTile(8)?.kind,"corner");
assert.equal(pieceForTile(4)?.kind,"centre");
assert.equal(candidateTargets(5).length,24);
assert.equal(candidateTargets(8).length,24);
assert.deepEqual(candidateTargets(4),[4]);
assert.equal(compatibleTarget(5,7),true);
assert.equal(compatibleTarget(5,8),false);
assert.equal(compatibleTarget(4,4),true);
assert.equal(compatibleTarget(4,13),false);

const unlocked=buildTweakConstraints({unlockedPieces:new Set(["E0"])});
assert.equal(unlocked.confirmations[5],undefined);
assert.equal(unlocked.confirmations[10],undefined);
assert.deepEqual(unlocked.confirmations[7],{target:7,rotation:0});

const mapped=buildTweakConstraints({requests:new Map([[5,{target:7,rotation:0}]])});
assert.deepEqual(mapped.confirmations[5],{target:7,rotation:0});
assert.equal(mapped.confirmations[10],undefined,"source cubie's companion sticker must be free");
assert.equal(mapped.confirmations[19],undefined,"target cubie's companion sticker must be free");

const solvedState="UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const solved=completeTweakTarget();
assert.equal(solved.analysis?.ok,true);
assert.equal(Number(solved.analysis?.legalStateCount),1);
assert.equal(solved.completion?.resolved,true);
assert.equal(solved.completion?.state,solvedState);

const compensated=completeTweakTarget({unlockedPieces:new Set(["E0","E1"])});
assert.equal(compensated.analysis?.ok,true);
assert.equal(compensated.completion?.resolved,true,"the engine should choose one exact legal completion for unlocked compensation cubies");
assert.equal(compensated.completion?.state,solvedState,"least-disturbance completion should prefer the solved arrangement when it is legal");

// Pick a non-identity edge placement that is known to be geometrically valid.
// With every other piece frozen it creates a parity contradiction. The new
// observation must win and the model must release the minimum old assumption.
const unconstrained=analyseStickerConstraints({confirmations:{},ambiguities:{},centerRotations:[0,0,0,0,0,0]});
const legalOption=unconstrained.stickers[5].domain.find(option=>Number(option.target)!==5);
assert.ok(legalOption,"expected at least one non-identity legal edge placement");
const uiRotation=mod4(4-Number(legalOption.rotation));
const correction=new Map([[5,{target:Number(legalOption.target),rotation:uiRotation}]]);
const authoritative=completeTweakTarget({requests:correction});
assert.equal(authoritative.analysis?.ok,true);
assert.equal(authoritative.completion?.resolved,true,"an authoritative correction should be reconciled automatically");
assert.ok((authoritative.autoUnlockedPieces?.length||0)>=1,"at least one prior cubie assumption should be released when parity requires it");
assert.deepEqual(authoritative.completion?.confirmed?.[5],{target:Number(legalOption.target),rotation:Number(legalOption.rotation)});

// The reconstruction engine must also remain capable of completing an exact
// legal state when every old non-centre assumption is released. This is the
// safety-net used when more than two assumptions from the previous 'solved'
// reconstruction were wrong. The authoritative observation must survive it.
const allPieces=new Set();
for(let tile=0;tile<54;tile++){
  const piece=pieceForTile(tile);
  if(piece&&piece.kind!=="centre")allPieces.add(piece.key);
}
const rebuilt=completeTweakTarget({requests:correction,unlockedPieces:allPieces});
assert.equal(rebuilt.analysis?.ok,true);
assert.equal(rebuilt.completion?.resolved,true,"a fully released reconstruction should still collapse to one legal state");
assert.deepEqual(rebuilt.completion?.confirmed?.[5],{target:Number(legalOption.target),rotation:Number(legalOption.rotation)},"the authoritative observation must remain fixed during a full rebuild");

console.log("post-solve tweak model tests passed");
