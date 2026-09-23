# Picture Cube Solver

A browser-native 3×3 picture-cube solver for cubes where the stickers form a map, photograph or other continuous artwork instead of six flat colours.

The application is built around **live camera capture**. It does not ship with, depend on, or compare against the development photographs that were used during the original Earth-cube proof of concept.

## Live scan flow

The browser guides the user through six captures:

1. choose any side as the front and scan it;
2. rotate the whole cube 90° clockwise as viewed from above and scan the next side;
3. rotate clockwise again and scan the back;
4. rotate clockwise once more and scan the fourth side;
5. return to the original front, tilt the cube towards the camera, and scan the top with the original front edge at the bottom of the frame;
6. return again and scan the bottom with the original front edge at the top of the frame.

The review screen allows each capture to be rotated in 90° increments or retaken without restarting the other five faces. A stability detector can auto-capture after the cube is held still, while the manual capture button remains available.

## Recognition model

There is deliberately no Earth-specific classifier and no hard-coded solved image. The Python backend treats the picture as a constrained jigsaw whose pieces happen to be attached to Rubik cubies.

For every captured sticker it builds exposure-resistant border descriptors. It then:

- groups stickers into the 12 physical edge cubies and 8 physical corner cubies from their current positions;
- enumerates every rigidly valid destination and orientation for each cubie;
- scores how well transformed sticker borders continue into the fixed centre artwork;
- reconstructs all edges with a dynamic-programming one-to-one assignment while enforcing total edge-flip parity;
- infers one shared quarter-turn orientation for each centre and resolves the edges again;
- reconstructs corners against the already placed edge borders while enforcing total corner twist and matching edge/corner permutation parity;
- rejects any interpretation that cannot be a legal 3×3 state.

The in-plane rotation of every sticker is calculated from a proper 3D rotation matrix. The matcher therefore compares the artwork in the orientation it would physically have in the candidate solved position rather than pretending picture stickers behave like plain colours.

This is particularly useful for ocean-heavy Earth cubes. A nearly featureless blue sticker is allowed to remain ambiguous until the rest of the image and the cube's physical constraints force a consistent assignment.

## Browser architecture

The deployed site is static GitHub Pages, but the computational backend is Python running in a dedicated Web Worker:

```text
Camera + capture UI (JavaScript)
          │
          ▼
Web Worker
          │
          ▼
Pyodide 0.29.5 (Python/WASM)
          │
          ├── picture-border reconstruction
          ├── 3D cubie-orientation geometry
          ├── Rubik legality constraints
          └── rubik-solver-py two-phase solver
          │
          ▼
move sequence + picture-centre correction
          │
          ▼
Three.js 3D copy using the captured sticker textures
```

The worker starts while the camera workflow is in progress. Kociemba move/pruning tables are built off the UI thread and persisted in IndexedDB where the browser permits it, so later visits can reuse them.

Camera frames remain in the current browser tab. There is no image upload endpoint or application server.

## Centre orientation

A normal 3×3 solver ignores the rotation of fixed centres. Picture cubes cannot. The reconstruction records how many clockwise quarter-turns each captured centre would need to match the solved artwork, tracks the effect of the ordinary solve on those centres, then appends standard supercube centre algorithms.

The correction generator uses two legal operations:

- rotate one centre 180° while leaving the solved cubies intact;
- rotate one centre +90° and an adjacent centre -90° while leaving the solved cubies intact.

A small breadth-first search chooses a sequence of these operations for the remaining reachable centre-orientation state.

## Development

The GitHub Pages build/runtime foundation is pinned as a git submodule at `vendor/pages` from [`kitty-crow/github-pages-template`](https://github.com/kitty-crow/github-pages-template).

```bash
git submodule update --init --recursive
bun install
bun run check
bun run build
bun run audit:mobile
```

`bun run check` also runs deterministic Python reconstruction tests. The tests synthesise continuous six-face artwork, scramble the virtual physical cube in 3D, rotate every sticker exactly as the corresponding cubie would rotate, and verify that the image reconstruction recovers both the cubie state and centre orientations.

Serve `site/` over HTTP or HTTPS to test the camera. Browser camera APIs do not work from an ordinary `file://` URL.

## Deployment

Pushes to `main` run `.github/workflows/pages.yml`. The workflow checks JavaScript and Python syntax, runs the reconstruction tests, builds through the pinned Pages template, runs the template's mobile-responsiveness audit, and deploys the generated `site/` artefact to GitHub Pages.

Expected URL:

`https://kitty-crow.github.io/cube-solver/`

## Runtime dependencies

- Pyodide 0.29.5
- `rubik-solver-py` 0.1.1, MIT, installed inside Pyodide
- Three.js 0.180.0
- `github-pages-template`, pinned git submodule

## Limitations

The camera capture currently uses a fixed square guide rather than automatic perspective-corner detection, so the photographed face should be held reasonably square to the camera. Strong glare, motion blur, a cube that occupies only a small part of the guide, or artwork that is genuinely identical across complete cubies can reduce reconstruction confidence.

The scanner is for a conventional 3×3 mechanism with fixed centres. It is not intended for 2×2, 4×4, mirror cubes, bandaged cubes, or puzzles with movable centres.

## Licence

MIT. See `LICENSE`.
