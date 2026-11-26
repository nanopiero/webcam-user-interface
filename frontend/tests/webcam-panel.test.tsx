import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getProvider, getWebcam } from "../src/api/client";
import WebcamPanel from "../src/features/webcams/WebcamPanel";

vi.mock("../src/api/client", () => ({ getProvider: vi.fn(), getWebcam: vi.fn() }));

it("loads the provider image immediately and distinguishes download, processing and UI reception times", async () => {
  const provider = { page_url: "https://example.org/webcam", image_url: "https://example.org/current.jpg", available: true, image_embeddable: true };
  vi.mocked(getProvider).mockResolvedValue(provider);
  vi.mocked(getWebcam).mockResolvedValue({ processing_stream_id: "test", name: "Example webcam", latitude: 47, longitude: 2,
    altitude: 100, country: null, platform: "example", platform_name: "Example", source_stream_id: "test", provider_kind: "windy",
    tags: [], blacklisted: false, predictions: [{ output_id: 1, parameter: "snow",
      download_timestamp: "2026-11-17T10:00:00Z", acquisition_timestamp: "2026-11-17T10:00:01Z",
      processing_timestamp: "2026-11-17T10:00:02Z", received_at: "2026-11-17T10:00:05Z",
      provider_timestamp: null, publication_timestamp: "2026-11-17T10:00:03Z",
      snow_raw_lower: -1, snow_raw_upper: -0.5, snow_class: 10, snow_qualification: 2,
      visibility_raw_lower: null, visibility_raw_upper: null, visibility_lower: null,
      visibility_upper: null, visibility_center: null, model_version: null, quality_code: 0 }],
    provider: { ...provider, image_url: null } });
  render(<WebcamPanel cameraId="test" site={{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
    properties: { id: "site", platform: "example", name: "Example", n: 1, cls: "white", u: false, cams: [
      { p: "test", name: "Example webcam", x: 2, y: 47, altitude: 100, country: null, cls: "white", u: false, w: null, t: null, vl: null, vu: null, value: null },
    ] } }} parameter="snow" administrator={{ session: null, error: "", busy: false, check: async () => {},
      signIn: async () => false, signOut: async () => {}, change: async () => {} }}
    onHistory={vi.fn()} onChanged={vi.fn()} onClose={vi.fn()} historical={false} revision={0} />);
  expect(await screen.findByRole("img", { name: "Current view from Example webcam" })).toHaveAttribute("src", provider.image_url);
  expect(getProvider).toHaveBeenCalledWith("test", expect.any(AbortSignal));
  expect(screen.queryByRole("button", { name: "Show current image" })).not.toBeInTheDocument();
  expect(await screen.findByText("Intermediate snow cover", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("Download in E-SOH").nextElementSibling).toHaveTextContent("2026-11-17 10:00:00 UTC");
  expect(screen.getByText("Processed", { exact: true }).nextElementSibling).toHaveTextContent("2026-11-17 10:00:02 UTC");
  expect(screen.getByText("UI backend reception").nextElementSibling).toHaveTextContent("2026-11-17 10:00:05 UTC");
});
