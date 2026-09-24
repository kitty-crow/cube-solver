# Reference pipeline v0.7

- Search and matching are separate. Search returns artwork candidates only.
- Selecting a candidate immediately fits that one image; there is no second match button.
- Selecting another candidate replaces the in-flight fit.
- On odd-order cubes, the six fixed centres are hard anchors for the reference frame.
- Equirectangular references are searched over the full spherical orientation space and refined below one degree.
- Once fitted to fixed centres, the reference cannot be relabelled by a later whole-cube rotation.
- Centre scan tiles can only correspond to same-face centre targets, and non-centre tiles cannot occupy centre targets.
