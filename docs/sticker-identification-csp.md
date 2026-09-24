# Adaptive sticker-identification constraint solver

Status: implementation specification for the 3×3 picture-cube workflow.

## 1. Purpose and separation of concerns

The application must treat three different problems as three different stages.

1. **Solved-picture registration** establishes one immutable connected wrap of the chosen source image over the six faces of the solved cube.
2. **Optional face calibration** permits small per-face corrections for printing/camera mismatch. It may change how the source is sampled inside a face, but must not change the identity of the six faces or turn them into independent cameras.
3. **Scramble identification** determines which solved sticker each photographed physical sticker currently contains. This stage must not modify the solved-picture registration.

The third stage answers only:

> For photographed facelet `s`, which solved target facelet `t` is it, and by which legal quarter-turn is the artwork rotated?

The answer is a pair `(t, q)` where `q ∈ Z4 = {0,1,2,3}` represents `0°, 90°, 180°, 270°` clockwise. Arbitrary rotation, zoom, warp, yaw, pitch, roll, or scale changes are forbidden in this stage.

## 2. Canonical indexing

Face order is `U R F D L B` everywhere. For a 3×3 face, local indices are row-major `0..8`.

A global facelet index is

`g(f, i) = 9 f + i`, where `f ∈ {0..5}` and `i ∈ {0..8}`.

Human labels are `U0..U8`, `R0..R8`, ..., `B0..B8`.

The six centre facelets are fixed anchors:

`C = {U4, R4, F4, D4, L4, B4}`.

They are not asked again during scramble identification. The 48 non-centre facelets are the interactive set.

The canonical physical piece partition is the same one already used by `web/py/cube_backend/geometry.py`:

### Edges

`UR=(U5,R1)`
`UF=(U7,F1)`
`UL=(U3,L1)`
`UB=(U1,B1)`
`DR=(D5,R7)`
`DF=(D1,F7)`
`DL=(D3,L7)`
`DB=(D7,B7)`
`FR=(F5,R3)`
`FL=(F3,L5)`
`BL=(B5,L3)`
`BR=(B3,R5)`

### Corners

`URF=(U8,R0,F2)`
`UFL=(U6,F0,L2)`
`ULB=(U0,L0,B2)`
`UBR=(U2,B0,R2)`
`DFR=(D2,F8,R6)`
`DLF=(D0,L8,F6)`
`DBL=(D6,B8,L6)`
`DRB=(D8,R8,B6)`

The implementation must use the generated `EDGE_GEOM` / `CORNER_GEOM` semantics, not a second incompatible cube convention.

## 3. Variables

For each current physical edge position `e ∈ {0..11}`, define a discrete variable

`E_e = (h, o)`

where `h` is the solved edge identity/home position and `o ∈ Z2` is edge orientation.

For each current physical corner position `c ∈ {0..7}`, define

`K_c = (h, o)`

where `h` is the solved corner identity/home position and `o ∈ Z3` is corner twist.

Every value of `E_e` or `K_c` deterministically induces a placement for every sticker on that physical cubie:

`P(s) = (target_facelet, quarter_turn)`.

This mapping is generated with the same proper 3D axis rotations and `_tile_rotation` rule used in `geometry.py`. Therefore the sticker-level rotation is not an extra free variable once a cubie candidate has been chosen.

A user confirmation

`H_s = (t, q)`

is a hard constraint requiring the selected cubie candidate containing physical sticker `s` to contain exactly the placement `(t,q)`.

## 4. Hard constraints

A complete state is legal iff all of the following hold.

### 4.1 Centre anchors

Centre identities are fixed by solved-picture registration and are never reassigned.

### 4.2 All-different cubie identity

The 12 current physical edge positions must use every solved edge home exactly once.

The 8 current physical corner positions must use every solved corner home exactly once.

This also guarantees that no solved non-centre sticker target can be occupied by two different physical stickers.

### 4.3 Edge orientation invariant

`Σ o(E_e) ≡ 0 (mod 2)`.

### 4.4 Corner orientation invariant

`Σ o(K_c) ≡ 0 (mod 3)`.

### 4.5 Permutation parity

`parity(edge permutation) = parity(corner permutation)`.

### 4.6 User confirmations

For every confirmed photographed sticker `s`, the chosen cubie candidate must induce exactly `H_s`.

Two explicit confirmations may not claim the same solved target facelet. Attempting to do so is rejected before the constraint state is committed.

## 5. Exact legal-state counting

The constraint engine must not estimate legality from image confidence. Legality is exact.

For each family, current positions are processed in canonical numeric order. Dynamic programming state is:

### Edges

`(i, usedMask, flipSum, permutationParity)`

where:

- `i` is the next current edge position,
- `usedMask` is a 12-bit solved-home occupancy mask,
- `flipSum ∈ Z2`,
- `permutationParity ∈ Z2`.

When assigning solved home `h` at current index `i`, the parity increment is

`popcount(usedMask & ~((1 << (h + 1)) - 1)) mod 2`.

At `i=12`, a completion is accepted iff `flipSum=0` and its requested final parity is satisfied.

### Corners

The same DP is used with an 8-bit occupancy mask and `twistSum ∈ Z3`.

At `i=8`, a completion is accepted iff `twistSum=0` and the requested final parity is satisfied.

Let `E0,E1` be edge-completion counts by parity and `K0,K1` corner-completion counts. The total number of legal full cube states is

`N = E0*K0 + E1*K1`.

Counts may be saturated for UI display, but zero/non-zero and uniqueness must remain exact.

A cubie candidate is **supported** iff forcing it leaves at least one full legal state after parity coupling to the other family. Sticker domains are the union of placements induced by supported candidates.

## 6. Status of a photographed sticker

For every non-centre physical sticker `s`, define its supported domain

`D_s = {(t,q) | at least one full legal cube state contains P(s)=(t,q)}`.

The UI state is:

- `confirmed`: the user explicitly supplied `H_s`;
- `inferred`: no explicit confirmation exists and `|D_s| = 1`;
- `unresolved`: `|D_s| > 1`;
- `conflict`: `D_s = ∅` or the total legal-state count is zero.

The UI must expose only the degrees of freedom that still exist.

Examples:

- If `D_s = {(F2,1)}`, do not ask the user. Infer `F2 @ 90°`.
- If `D_s = {(F2,1),(R6,3)}`, offer only those two position/rotation combinations.
- If all supported values for target `F2` use rotation `1`, then landing on `F2` must show only `90°`; the other quarter-turn controls are hidden/disabled.

## 7. Recognition is a prior, never a legality rule

The existing `absolute_f32` similarity matrix remains useful. It is used only to:

1. rank supported `(target,rotation)` suggestions;
2. initialise the pan view at the best supported guess;
3. choose the next unresolved sticker to ask about.

It must never override a hard user confirmation or admit an illegal cube state.

For physical sticker `s`, let the supported scores sorted descending be `v1 ≥ v2 ≥ ...`. Define a visual ambiguity term

`A_s = 1 - clamp((v1-v2)/0.12, 0, 1)`

with `A_s=0` for a singleton domain.

Define domain entropy proxy

`H_s = clamp(log2(|D_s|)/5, 0, 1)`.

The next-question priority is

`Q_s = 0.72 A_s + 0.28 H_s`.

The unresolved sticker with maximal `Q_s` is asked next. This starts with the least certain/highest-information stickers and naturally moves toward increasingly certain ones as constraints collapse.

## 8. Manual interaction model

### 8.1 Immutable reference

At scramble-identification time the solved wrap is frozen. The UI must not mutate:

- global wrap orientation,
- source scale,
- per-face calibration,
- warp,
- face identity,
- seam topology.

### 8.2 Allowed interaction

The photographed sticker stays fixed. The already-agreed solved reference moves underneath it.

The user may:

- pan across the connected solved cube surface;
- rotate the reference by quarter-turns only;
- confirm the currently selected `(target, quarterTurn)`;
- unassign a previous explicit confirmation.

No other transform is available.

Panning is surface-aware. Crossing a face boundary folds onto the physically adjacent face; it does not wrap through a 2D atlas as if faces were unrelated rectangles.

### 8.3 Occupancy

A target facelet already consumed by a hard confirmation or mathematically forced by the current legal-state set is not offered as a conflicting assignment for another sticker.

### 8.4 Conflict handling

Before persisting a new confirmation, recompute legality. If the legal-state count becomes zero:

- reject the new confirmation;
- leave the previous state intact;
- explain that it conflicts with existing assignments;
- allow the user to review/unassign earlier confirmations.

## 9. Stop condition

The user is never required to identify all 48 non-centre stickers.

The interactive questioning stops as soon as `N = 1`.

At that point every current physical cubie identity/orientation and every sticker `(target, quarterTurn)` is mathematically determined. All remaining unconfirmed stickers are marked inferred.

If `N > 1`, questioning continues with the highest-priority unresolved sticker.

## 10. Resolved scramble payload

When unique, the constraint engine serialises:

```json
{
  "version": 1,
  "resolved": true,
  "state": "<54-character URFDLB facelet string>",
  "center_rotations": [0,0,0,0,0,0],
  "placements": {
    "0": {"target": 17, "rotation": 1, "source": "inferred"}
  },
  "confirmed": {
    "17": {"target": 25, "rotation": 3}
  },
  "legal_state_count": 1
}
```

`state[currentFacelet]` is the solved face letter of the target face to which that physical sticker belongs. Centres remain canonical.

`center_rotations` comes from the already-aligned centre anchors, not from re-identifying the centres in this stage.

## 11. Solver integration

If a resolved manual-identification payload is present, the Python solver must treat it as authoritative:

1. validate the supplied 54-character state with the cube legality verifier;
2. solve that exact cubie state;
3. apply the already-known centre rotations;
4. append centre-correction moves;
5. never rerun fuzzy sticker reassignment for that solve.

If the payload is absent, the existing negotiated visual reconstruction remains the fallback path.

Priority is therefore:

`centre anchors > explicit user confirmations > exact mechanical inference > visual recognition`.

## 12. Persistence

Persist after every confirmation/unassignment:

- explicit confirmations;
- current photographed sticker;
- current pan face/UV;
- current quarter-turn;
- latest constraint-analysis summary;
- resolved scramble when unique.

This state is stored with the selected reference session and restored on reload. Changing the solved reference mapping invalidates the scramble-identification state because target artwork cells may have changed meaning.

## 13. UI progress

The identification panel displays at minimum:

`confirmed · inferred · unresolved · legal states`

Examples:

`7 confirmed · 23 inferred · 18 unresolved · 36 legal states`

or, once finished:

`9 confirmed · 39 inferred · unique legal scramble`

A 48-cell review grid lets the user revisit explicit confirmations and unassign mistakes.

## 14. Non-goals

This stage does not:

- change the reference image or its solved wrap;
- perform arbitrary image transforms;
- ask centre identities again;
- allow duplicate solved target occupancy;
- accept an image-preferred assignment that violates cube mechanics;
- force the user to manually label all 48 non-centre stickers.
