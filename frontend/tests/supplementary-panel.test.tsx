import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getSupplementaryProvider, getSupplementaryWebcam } from "../src/api/client";
import SupplementaryPanel from "../src/features/webcams/SupplementaryPanel";

vi.mock("../src/api/client", () => ({ getSupplementaryProvider: vi.fn(), getSupplementaryWebcam: vi.fn() }));

it("shows one provider link and the relevant logo when the page is also the published media URL", async () => {
  const url = "https://www.meteo-centre.fr/example.jpg";
  vi.mocked(getSupplementaryWebcam).mockResolvedValue({ id: "additional", name: "Additional webcam", latitude: 47,
    longitude: 2, altitude: 100, altitude_source: null, altitude_band: null, provider_url: url, links: [url],
    description: "", source_map_url: null, source_map_name: "uMap", source_layer_name: "Example",
    source_feature_id: "example", exported_at: null, metadata: {} });
  vi.mocked(getSupplementaryProvider).mockResolvedValue({ page_url: url, media: [{ kind: "image", url }] });
  render(<SupplementaryPanel webcam={{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
    properties: { id: "additional", name: "Additional webcam", altitude: 100, source_layer_name: "Example" } }} onClose={vi.fn()} />);
  expect(await screen.findByRole("img", { name: "Météo Centre logo" })).toBeInTheDocument();
  expect(await screen.findAllByRole("link", { name: "Open provider webcam ↗" })).toHaveLength(1);
  expect(screen.queryByRole("link", { name: "Open this provider view ↗" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Other published links" })).not.toBeInTheDocument();
});
