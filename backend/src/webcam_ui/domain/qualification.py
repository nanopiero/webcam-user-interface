"""Published snow qualification, using the ML service's scene.snow_status codes."""

SNOW_QUALIFICATION_CODES = {"disqualified": 0, "incomplete": 1, "qualified": 2}
QUALIFIED_SCENE_STATUS = 2


def snow_qualification_passed(status: int | None) -> bool:
    return status == QUALIFIED_SCENE_STATUS
