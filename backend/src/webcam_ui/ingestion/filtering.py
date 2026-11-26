"""Independent country and geographic filters. Missing country is never inferred."""

from webcam_ui.domain.observations import Observation
from webcam_ui.settings import FilterSettings


def rejection_reason(observation: Observation, settings: FilterSettings) -> str | None:
    if observation.country is not None and observation.country not in settings.allowed_countries:
        return "country"
    box = settings.bounding_box
    if box.enabled and not (box.west <= observation.longitude <= box.east
                            and box.south <= observation.latitude <= box.north):
        return "bounding_box"
    return None
