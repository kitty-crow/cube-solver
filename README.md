# Picture Cube Solver

A browser-native 3×3 picture-cube solver for cubes where the stickers form a map, photograph or other continuous artwork instead of six flat colours.

The application is designed around **live camera capture**. It does not ship with, depend on or compare against the development photographs used while prototyping the Earth cube.

## Live scan flow

The user is guided through six captures:

1. choose any front face and scan it;
2. rotate the whole cube 90° clockwise as viewed from above and scan the next side;
3. repeat for the back;
4. repeat for the left side;
5. return to the original front orientation and scan the top;
6. return again and scan the bottom.

The review screen allows any capture to be rotated in 90° increments or retaken before solving.

## How it recognises a picture cube

There is deliberately no Earth-specific classifier and no hard-coded solved image.

The Python backend reconstructs the intended picture from the six scans themselves:

- the scan sequence establishes the fixed centre adjacency and therefore the cube coordinate frame;
- each sticker is cropped and represented with exposure-resistant chromaticity and local luminance features;
- each physical edge cubie is tested in every target edge position and both legal orientations;
- edge-to-centre boundary continuity gives a global one-to-one edge assignment;
- centre artwork orientation is co-optimised with the edge assignment;
- corners are then assigned against the already reconstructed edge borders in all three legal orientations;
- multiple near-optimal assignments are retained and rejected if they imply an impossible Rubik's Cube state;
- the remaining legal state is solved using a two-phase Kociemba solver;
- centre artwork orientation is tracked through the solve and, when required, picture-cube centre algorithms are appended.

This is especially useful for ocean-heavy Earth cubes: a nearly featureless blue sticker is allowed to remain ambiguous until the rest of the cube constrains where it can legally go.

## Browser architecture

The deployed site is static GitHub Pages, but the computational backend is still Python:

```text
Camera / UI (JavaScript)
        │
        ▼
Web Worker
        │
        ▼
Pyodide 0.29.5 (Python/WASM)
        │
        ├── NumPy picture reconstruction
        ├── Rubik legality constraints
        └── rubik-solver-py two-phase solver
        │
        ▼
Move sequence + centre correction
        │
        ▼
Three.js 3D copy of the scanned cube
```

The worker is started while the user scans, so the Python runtime and Kociemba tables can warm in the background instead of blocking the interface after the sixth capture.

All camera frames remain in the current browser tab. There is no upload endpoint or application server.

## Development

The GitHub Pages build/runtime foundation is pinned as a submodule at `vendor/pages` from [`kitty-crow/github-pages-template`](https://github.com/kitty-crow/github-pages-template).

```bash
git submodule update --init --recursive
bun install
bun run check
bun run build
```

Serve `site/` over HTTP/HTTPS to test camera access. Camera APIs do not work from an ordinary `file://` URL.

## Deployment

Pushes to `main` run `.github/workflows/pages.yml`, which checks the JavaScript and Python sources, builds through the vendored Pages template, runs its mobile responsiveness audit and deploys the generated `site/` artefact to GitHub Pages.

Expected deployment URL:

`https://kitty-crow.github.io/cube-solver/`

## Runtime dependencies

- [Pyodide](https://pyodide.org/) 0.29.5, loaded from jsDelivr
- [rubik-solver-py](https://github.com/mrrtmob/rubik-solver-py) 0.1.1, MIT, installed into Pyodide at runtime
- [Three.js](https://threejs.org/) 0.180.0, loaded from jsDelivr
- [`github-pages-template`](https://github.com/kitty-crow/github-pages-template), pinned git submodule

The centre-orientation post-solve uses standard picture/supercube centre rotations. A useful reference for the outer-layer forms is [Rotating Centres](https://tilde.club/~notfire/cube/3x3x3_x_rotating_centres.htm).

## Limitations

Picture matching depends on visible continuity. Severe glare, motion blur, a face occupying only a small part of the capture, or artwork that is genuinely identical across several complete cubies can reduce confidence. The UI reports reconstruction confidence and keeps the six scans visible for manual orientation review.

The current scanner expects a conventional 3×3 mechanism with fixed centres. It is not intended for 2×2, 4×4, mirror cubes, bandaged cubes or puzzles with movable centres.

## Licence

MIT. See `LICENSE`.
