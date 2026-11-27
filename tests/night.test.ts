import { describe, expect, test } from "vitest";
import { GET, latestDateOnEarth } from "../api/night";

describe("night API", () => {
  test("latest date on Earth is UTC+14", () => {
    expect(latestDateOnEarth(Date.UTC(2026, 10, 27, 9, 59))).toBe("2026-11-27");
    expect(latestDateOnEarth(Date.UTC(2026, 10, 27, 10, 0))).toBe("2026-11-28");
  });
  test("a started night is served, a future one is not", async () => {
    const ok = await GET(new Request("https://x/api/night?date=2026-11-26"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).items.length).toBeGreaterThan(0);
    const later = await GET(new Request("https://x/api/night?date=2099-01-01"));
    expect(later.status).toBe(404);
    const bad = await GET(new Request("https://x/api/night?date=../../etc"));
    expect(bad.status).toBe(400);
  });
});
