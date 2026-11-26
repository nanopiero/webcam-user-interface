"""Horizontal great-circle exclusion without GIS dependencies or country inference."""

from collections import defaultdict
from itertools import product
from math import cos, floor, radians, sin

EARTH_RADIUS_METRES = 6371008.8


def cartesian(latitude: float, longitude: float) -> tuple[float, float, float]:
    latitude, longitude = radians(latitude), radians(longitude)
    return (EARTH_RADIUS_METRES * cos(latitude) * cos(longitude),
            EARTH_RADIUS_METRES * cos(latitude) * sin(longitude),
            EARTH_RADIUS_METRES * sin(latitude))


class RadiusIndex:
    """3-D spatial hash: query the 27 neighbouring cells, including across the date line."""

    def __init__(self, coordinates, radius_metres: float):
        self.width = 2 * EARTH_RADIUS_METRES * sin((radius_metres + 1e-7) / (2 * EARTH_RADIUS_METRES))
        self.cells = defaultdict(list)
        for latitude, longitude in coordinates:
            point = cartesian(latitude, longitude)
            self.cells[self.cell(point)].append(point)

    def cell(self, point):
        return tuple(floor(value / self.width) for value in point)

    def contains_nearby(self, latitude: float, longitude: float) -> bool:
        point = cartesian(latitude, longitude)
        cell = self.cell(point)
        for offset in product((-1, 0, 1), repeat=3):
            key = tuple(value + delta for value, delta in zip(cell, offset, strict=True))
            for candidate in self.cells.get(key, ()):
                if sum((a - b) ** 2 for a, b in zip(point, candidate, strict=True)) <= self.width ** 2:
                    return True
        return False
