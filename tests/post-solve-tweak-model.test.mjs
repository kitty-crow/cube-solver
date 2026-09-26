import assert from "node:assert/strict";
import {
  buildTweakConstraints,
  candidateTargets,
  compatibleTarget,
  completeTweakTarget,
  pieceForTile,
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

const solved=completeTweakTarget();
assert.equal(solved.analysis?.ok,true);
assert.equal(Number(solved.analysis?.legalStateCount),1);
assert.equal(solved.completion?.resolved,true);
assert.equal(solved.completion?.state,"UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");

console.log("post-solve tweak model tests passed");
