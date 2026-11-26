"""Only classifications supported by published values, following the reference admin UI."""

SNOW_CLASSES = {
    0: ("snow.none", False), 1: ("snow.undifferentiated", False),
    10: ("snow.intermediate", False), 30: ("snow.none", True),
    31: ("snow.undifferentiated", True), 310: ("snow.intermediate", True),
}
VISIBILITY_LADDER = (0, 200, 500, 1000, 1500, 3000, 5000, 8000, 10000, 20000)


def visibility_class(lower: float | None, upper: float | None) -> str | None:
    if lower is None or upper is None:
        return None
    floor = max((value for value in VISIBILITY_LADDER if value <= lower), default=0)
    ceiling = next((value for value in VISIBILITY_LADDER if value > upper), 20000)
    if ceiling <= floor:
        floor, ceiling = VISIBILITY_LADDER[-2:]
    return f"visibility.{floor}_{ceiling}"


def classify(parameter: str, record: dict | None) -> tuple[str, bool, str | None]:
    if record is None:
        return "white", False, "no_record"
    if parameter == "snow":
        result = SNOW_CLASSES.get(record.get("snow_class"))
        if result:
            if (result[0] == "snow.undifferentiated"
                    and record.get("snow_threshold_low") is not None
                    and record.get("snow_threshold_high") is not None):
                return "snow.high", result[1], None
            return result[0], result[1], None
    else:
        result = visibility_class(record.get("visibility_lower"), record.get("visibility_upper"))
        if result:
            return result, False, None
    return "white", False, "no_published_derived_result"
