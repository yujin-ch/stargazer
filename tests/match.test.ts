import { describe, it, expect } from "vitest";
import { makeMatcher, normalize, withinOne } from "../src/match";
import { OBJECTS } from "../src/library";
import { dailySky } from "../src/daily";

const m = makeMatcher(OBJECTS.map((o) => o.names));
const names = (id: string) => OBJECTS.find((o) => o.id === id)!.names;

describe("normalize", () => {
  it("folds case, articles, punctuation, accents", () => {
    expect(normalize("  The Hot-Dog ")).toBe(normalize("hotdog"));
    expect(normalize("Piñata")).toBe("pinata");
    expect(normalize("colour")).toBe(normalize("color"));
  });
});

describe("matching", () => {
  it("accepts aliases and spelling variants", () => {
    expect(m.test("donut", names("doughnut"))).toBeTruthy();
    expect(m.test("Doughnuts", names("doughnut"))).toBeTruthy();
    expect(m.test("aubergine", names("eggplant"))).toBeTruthy();
    expect(m.test("chilli pepper", names("chili"))).toBeTruthy();
    expect(m.test("grape", names("grapes"))).toBeTruthy();
    expect(m.test("sock", names("socks"))).toBeTruthy();
    expect(m.test("a cat", names("cat"))).toBeTruthy();
    expect(m.test("mice", names("mouse"))).toBeTruthy();
    expect(m.test("strawberries", names("strawberry"))).toBeTruthy();
  });
  it("tolerates one typo on long words", () => {
    expect(m.test("pinapple", names("pineapple"))).toBeTruthy();
    expect(m.test("brocolli", names("broccoli"))).toBeTruthy();
    expect(m.test("giraffe", names("giraffe"))).toBeTruthy();
    expect(m.test("girafe", names("giraffe"))).toBeTruthy();
    expect(m.test("telescpoe", names("telescope"))).toBeTruthy();
  });
  it("does not accept short partials or other words", () => {
    expect(m.test("ca", names("cat"))).toBeNull();
    expect(m.test("bu", names("bus"))).toBeNull();
    expect(m.test("dog", names("cat"))).toBeNull();
    expect(m.test("cst", names("cat"))).toBeNull();
  });
  it("withinOne", () => {
    expect(withinOne("abcdef", "abdcef")).toBe(true);
    expect(withinOne("abcdef", "abcde")).toBe(true);
    expect(withinOne("abcdef", "abxdeg")).toBe(false);
  });
});

describe("library", () => {
  it("has 150+ objects with unique ids", () => {
    expect(OBJECTS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(OBJECTS.map((o) => o.id)).size).toBe(OBJECTS.length);
  });
  it("every display name matches its own object", () => {
    for (const o of OBJECTS) for (const n of o.names) expect(m.test(n, o.names), `${o.id}: ${n}`).toBeTruthy();
  });
});

describe("daily sky", () => {
  it("is 40 objects, stable, and no repeats across a week", () => {
    expect(dailySky(1).length).toBe(40);
    expect(dailySky(5).map((o) => o.id)).toEqual(dailySky(5).map((o) => o.id));
    const week = Array.from({ length: 7 }, (_, i) => dailySky(i + 1).filter((o) => o.band === 0).map((o) => o.id)).flat();
    // band 1 has 70+ objects, 10 per day: a week never repeats
    expect(new Set(week).size).toBe(week.length);
  });
});
