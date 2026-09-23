# Picture Cube Solver

Browser-native solver for conventional 2×2×2, 3×3×3 and 4×4×4 picture cubes whose stickers form continuous artwork rather than six flat colours.

The application uses live camera capture. Camera imagery stays in the browser and is not uploaded to an application server.

## Scan flow

The browser guides six captures in a fixed camera-relative orientation:

1. choose any side as Front;
2. rotate the whole cube 90° clockwise from above for Right;
3. rotate clockwise again for Back;
4. rotate clockwise again for Left;
5. return to the original Front, then tilt Top towards the camera;
6. return to the original Front, then tilt Bottom towards the camera.

A looping Three.js guide uses already captured faces as textures and solid grey for unknown faces so the required whole-cube movement can be copied directly.

## Visual reconstruction

The scan labels are camera-relative. Reconstruction decides where physical cubies belong in the solved picture.

The visual stack is deliberately hybrid:

- deterministic multi-depth colour and luminance profiles;
- tangent and normal image gradients;
- edge and texture continuity;
- wrapped continuity across all 12 physical cube edges, not only within flat faces;
- an adaptive learned ensemble for ambiguous seams;
- legal Rubik cubie geometry as a hard constraint.

The learned stage can use DINOv2, SuperPoint/LightGlue, EfficientLoFTR, XFeat and RoMaV2 evidence when the browser and hardware can support them. Models are staged rather than evaluated exhaustively against every possible pair. Cheap deterministic scoring eliminates most candidates first, DINO features add regional context, and heavier matchers are used on the lowest-margin seams. If a model cannot load or execute, reconstruction continues with the remaining evidence.

The neural layer never directly outputs a cube state. It produces seam-likelihood evidence. Python then searches for the best globally consistent physical arrangement subject to cubie type, orientation, permutation and parity constraints.

## Automatic acceleration

There are no acceleration query flags. Runtime capability detection chooses the available hardware automatically.

```text
camera tiles
    │
    ├── WebGPU, when available
    ├── WebGL2 compatibility path
    ├── ONNX Runtime Web WASM fallback
    └── CPU Web Worker pool for parallel seam scoring
              │
              ▼
      seam-likelihood tensor
              │
              ▼
       Pyodide reconstruction
              │
              ▼
       legal cube-state solver
```

GPU work and CPU threading are independent. A machine with an integrated GPU and multiple CPU cores can use both at the same time. GitHub Pages does not guarantee cross-origin isolation, so WASM pthreads are not assumed; ordinary dedicated Web Workers provide the portable parallel CPU path.

## Size-specific solving

### 2×2×2

Reconstruction assigns the eight physical corners and enforces legal corner orientation. A dedicated pocket-cube search produces the solution.

### 3×3×3

Edges and corners are reconstructed under flip, twist and permutation parity constraints. Fixed centre artwork orientation is retained and corrected after the ordinary cubie solve with legal supercube centre algorithms.

### 4×4×4

Reconstruction treats all 96 picture stickers as exact physical identities. The solver handles corners, exact wings, movable centres and even-cube parity. Tests replay the returned algorithm against 96 unique facelet IDs so a merely colour-solved but picture-wrong result cannot pass.

## Browser architecture

```text
Camera + scan guide
        │
        ▼
solver worker
        ├── adaptive ML worker
        │     ├── WebGPU / WebGL / WASM model execution
        │     └── threaded deterministic seam workers
        │
        └── Pyodide 0.29.5
              ├── global picture reconstruction
              ├── 3D cubie geometry
              ├── legality/parity constraints
              └── cube solvers
        │
        ▼
move sequence
        │
        ▼
Three.js playback using captured sticker textures
```

## Development

The GitHub Pages build/runtime foundation is pinned as a git submodule at `vendor/pages` from [`kitty-crow/github-pages-template`](https://github.com/kitty-crow/github-pages-template).

```bash
git submodule update --init --recursive
bun install
bun run check
bun run build
bun run audit:mobile
```

`bun run check` validates JavaScript and Python syntax and runs deterministic reconstruction, generic NxN geometry, exact 4×4 replay, wrapped-surface and ensemble-evidence tests.

## Deployment

Pushes to `main` run `.github/workflows/pages.yml`, build the static site, run the mobile-responsiveness audit and deploy to GitHub Pages.

`https://kitty-crow.github.io/cube-solver/`

## Runtime dependencies

- Pyodide 0.29.5
- `rubik-solver-py` 0.1.1
- Three.js 0.180.0
- ONNX Runtime Web, loaded lazily for learned visual evidence
- pretrained visual models loaded lazily only when required

## Current limitations

The camera still uses a fixed square crop rather than full perspective-corner rectification. Strong glare, motion blur and very small cube images can reduce evidence quality. Learned models are optional accelerators/evidence sources, so browser support, memory limits, CORS or model-provider availability can reduce the ensemble without disabling the deterministic solver.

RoMaV2 browser exports are substantially larger than the other models and are therefore reserved for hardware that passes the high-memory WebGPU gate. The smaller XFeat path remains available on ordinary hardware.

Mirror cubes, bandaged cubes and non-standard mechanisms are out of scope.

## Licence

MIT. See `LICENSE`.
