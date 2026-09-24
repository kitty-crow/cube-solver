# Reference worker contract

The browser reference pipeline intentionally has two phases:

1. `search` recognises the artwork subject and returns candidate reference images. It must not project or sticker-match every candidate.
2. Selecting a candidate sends `match` for that candidate only.

For odd-order cubes, the selected reference is expressed in the scanned fixed-centre frame before sticker evidence is produced. A scanned centre on face `F` may only correspond to the centre target on reference face `F`; edge and corner stickers may not occupy centre targets. Equirectangular references are fitted continuously to those six fixed centres and are not subjected to a second whole-cube relabelling afterwards.
