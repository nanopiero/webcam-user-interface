import { afterEach, expect, it, vi } from "vitest";
import { APIError, blacklist, getHistory, getMap, login, restore } from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());
it("sends admin credentials in the same-origin JSON request and protects blacklist writes with CSRF", async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ username: "admin", csrf_token: "test-csrf" }))));
  vi.stubGlobal("fetch", fetch);
  await login("admin", "test-only-password");
  expect(fetch.mock.calls[0][0]).toBe("/api/admin/login");
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ username: "admin", password: "test-only-password" });
  await blacklist("camera/id", "Example reason", "test-csrf");
  expect(fetch.mock.calls[1][0]).toBe("/api/admin/blacklist/camera%2Fid");
  expect(fetch.mock.calls[1][1].headers.get("X-CSRF-Token")).toBe("test-csrf");
});
it("handles empty successful writes and reports API rejection without a browser authentication challenge", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "invalid administrator credentials" }), { status: 401 })));
  await expect(restore("example", "csrf")).resolves.toBeUndefined();
  await expect(login("admin", "wrong")).rejects.toMatchObject<Partial<APIError>>({ status: 401, message: "invalid administrator credentials" });
});
it("requests timezone-aware ranges and continuation cursors without silently discarding older pages", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await getHistory("example", "snow", "2026-11-17T00:00:00Z", "2026-11-18T00:00:00Z", "older-page");
  const url = new URL(fetch.mock.calls[0][0], "https://example.test");
  expect(url.searchParams.get("cursor")).toBe("older-page");
  expect(url.searchParams.get("start")).toBe("2026-11-17T00:00:00Z");
});

it("requests all selected countries explicitly and bypasses the browser cache on refresh", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await getMap("snow", null, undefined, { countries: ["FR", "DE"], includeUnknownCountry: false });
  const url = new URL(fetch.mock.calls[0][0], "https://example.test");
  expect(url.searchParams.get("countries")).toBe("FR,DE");
  expect(url.searchParams.get("include_unknown_country")).toBe("false");
  expect(url.searchParams.get("qualified_only")).toBe("true");
  expect(fetch.mock.calls[0][1].cache).toBe("no-store");
});
