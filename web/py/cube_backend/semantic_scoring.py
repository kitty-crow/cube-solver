from __future__ import annotations


def patch_incremental_reconstructor(module) -> None:
    """Add absolute sticker-position evidence without duplicating NxN search code."""
    if getattr(module, "_SEMANTIC_SCORING_PATCHED", False):
        return
    original = module._incremental_score

    def scored(bank, candidate, occupancy):
        absolute = sum(
            bank.placement_score(
                placement.source_facelet,
                placement.rot,
                placement.target_facelet,
            )
            for placement in candidate.placements
        )
        return original(bank, candidate, occupancy) + absolute

    module._incremental_score = scored
    module._SEMANTIC_SCORING_PATCHED = True
