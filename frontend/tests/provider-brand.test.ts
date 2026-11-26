import { expect, it } from "vitest";
import { providerBrand } from "../src/features/webcams/providerBrand";

it.each([
  ["windy", "Windy"], ["skaping", "Skaping"], ["fintraffic", "Fintraffic"], ["meteo-centre", "Météo Centre"],
])("identifies the published %s provider even when its image has an unrelated CDN hostname", (kind, name) => {
  expect(providerBrand(kind, ["https://images.example.org/current.jpg"])?.name).toBe(name);
});

it("recognizes supplementary provider domains while respecting the original webcam page", () => {
  expect(providerBrand(null, ["https://www.meteo-centre.fr/webcam", "https://images-webcams.windy.com/example.jpg"])?.name).toBe("Météo Centre");
  expect(providerBrand(null, ["https://weathercam.digitraffic.fi/example.jpg"])?.name).toBe("Fintraffic");
  expect(providerBrand(null, ["https://images.skaping.com/example.jpg"])?.name).toBe("Skaping");
});

it("leaves unknown sites unbranded instead of matching provider names in paths or unrelated hosts", () => {
  expect(providerBrand(null, ["https://example.org/windy.com/camera", "https://windy.com.example.org/image.jpg"])).toBeNull();
  expect(providerBrand("unknown", ["not a URL"])).toBeNull();
});
