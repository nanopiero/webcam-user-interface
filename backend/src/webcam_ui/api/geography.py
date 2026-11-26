"""Use the same deployment extent for stored observations and supplementary map points."""

from webcam_ui.settings import BoundingBox

Bounds = tuple[float, float, float, float]


def deployment_bounds(requested: Bounds | None, box: BoundingBox) -> Bounds | None:
    """Intersect a requested extent with the deployment; reversed bounds represent an empty area."""
    if not box.enabled:
        return requested
    configured = (box.west, box.south, box.east, box.north)
    if requested is None:
        return configured
    return (max(requested[0], box.west), max(requested[1], box.south),
            min(requested[2], box.east), min(requested[3], box.north))


def empty_bounds(bounds: Bounds | None) -> bool:
    return bounds is not None and (bounds[0] > bounds[2] or bounds[1] > bounds[3])
