import { describe, expect, it } from "vitest";
import { makeMatcher } from "../src/match";

describe("near misses ask instead of accepting", () => {
  const m = makeMatcher([["cupcake", "cup cake"], ["teapot"], ["saxophone", "sax"]]);
  it("an exact name is not a typo", () => {
    expect(m.test("cupcake", ["cupcake", "cup cake"])?.typo).toBeFalsy();
    expect(m.test("sax", ["saxophone", "sax"])?.typo).toBeFalsy();
  });
  it("a swapped or wrong letter is a typo with the name it was close to", () => {
    expect(m.test("cupcaje", ["cupcake", "cup cake"])).toMatchObject({ typo: true, name: "cupcake" });
    expect(m.test("saxophane", ["saxophone", "sax"])).toMatchObject({ typo: true, name: "saxophone" });
  });
  it("one letter short is a typo flagged as early (maybe still typing)", () => {
    expect(m.test("saxophon", ["saxophone", "sax"])).toMatchObject({ typo: true, early: true });
  });
});
