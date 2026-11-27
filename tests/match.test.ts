import { describe, it, expect } from "vitest";
import { makeMatcher, normalize, withinOne } from "../src/match";
import { OBJECTS } from "../src/library";
import { dailySky } from "../src/daily";

const m = makeMatcher(OBJECTS.map((o) => o.names));
const names = (id: string) => OBJECTS.find((o) => o.id === id || o.id.endsWith(`:${id}`))!.names;

describe("normalize", () => {
  it("folds case, articles, punctuation, accents", () => {
    expect(normalize("  The Hot-Dog ")).toBe(normalize("hotdog"));
    expect(normalize("Piñata")).toBe("pinata");
    expect(normalize("colour")).toBe(normalize("color"));
  });
});

describe("matching", () => {
  it("accepts aliases and spelling variants", () => {
    expect(m.test("bunny", names("rabbit"))).toBeTruthy();
    expect(m.test("Rabbits", names("rabbit"))).toBeTruthy();
    expect(m.test("a cat", names("cat"))).toBeTruthy();
    expect(m.test("mice", names("mouse"))).toBeTruthy();
    expect(m.test("killer whale", names("orca"))).toBeTruthy();
    expect(m.test("alligator", names("crocodile"))).toBeTruthy();
  });
  it("tolerates one typo on long words", () => {
    expect(m.test("girafe", names("giraffe"))).toBeTruthy();
    expect(m.test("pengiun", names("penguin"))).toBeTruthy();
    expect(m.test("flamigo", names("flamingo"))).toBeTruthy();
  });
  it("does not accept short partials or other words", () => {
    expect(m.test("ca", names("cat"))).toBeNull();
    expect(m.test("dog", names("cat"))).toBeNull();
    expect(m.test("cst", names("cat"))).toBeNull();
    expect(m.test("bat", names("cat"))).toBeNull();
  });
  it("rejects near-miss real words", () => {
    const bad: [string, string][] = [["funny", "rabbit"], ["round", "dog"], ["sound", "dog"], ["mole", "mouse"], ["seat", "seal"]];
    for (const [typed, id] of bad) expect(m.test(typed, names(id)), `${typed} -> ${id}`).toBeNull();
  });
  it("accepts describing words", () => {
    expect(m.test("brown dog", names("dog"))).toBeTruthy();
    expect(m.test("big elephant", names("elephant"))).toBeTruthy();
  });
  it("withinOne", () => {
    expect(withinOne("abcdef", "abdcef")).toBe(true);
    expect(withinOne("abcdef", "abcde")).toBe(true);
    expect(withinOne("abcdef", "abxdeg")).toBe(false);
  });
});

describe("library", () => {
  it("has 80+ objects with unique ids", () => {
    expect(OBJECTS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(OBJECTS.map((o) => o.id)).size).toBe(OBJECTS.length);
  });
  it("every display name matches its own object", () => {
    for (const o of OBJECTS) for (const n of o.names) expect(m.test(n, o.names), `${o.id}: ${n}`).toBeTruthy();
  });
});

describe("daily sky", () => {
  it("is drawn from one theme, stable, and never repeats within a day", () => {
    const s = dailySky(1);
    expect(s.length).toBeGreaterThanOrEqual(24);
    expect(new Set(s.map((o) => o.theme)).size).toBe(1);
    expect(dailySky(5).map((o) => o.id)).toEqual(dailySky(5).map((o) => o.id));
    for (let d = 1; d <= 1000; d++) {
      const ids = dailySky(d).map((o) => o.id);
      expect(new Set(ids).size, `day ${d}`).toBe(ids.length);
    }
  });
});

describe("themes and conditions", () => {
  it("rotates themes and never repeats a condition two nights running", async () => {
    const { dayTheme, dayCondition } = await import("../src/daily");
    expect(new Set([1, 2, 3].map(dayTheme)).size).toBe(3);
    const { CONFIG } = await import("../src/config");
    if (CONFIG.conditionsOn) for (let d = 2; d < 400; d++) expect(dayCondition(d).id).not.toBe(dayCondition(d - 1).id);
    else for (let d = 1; d < 50; d++) expect(dayCondition(d).id).toBe("clear");
  });
  it("puts a Black Hole object in every sky of a theme that has them", () => {
    for (let d = 1; d <= 30; d++) {
      const s = dailySky(d);
      if (OBJECTS.some((o) => o.theme === s[0].theme && o.band === 4)) expect(s.some((o) => o.band === 4)).toBe(true);
    }
  });
});

describe("mystery link", () => {
  it("accepts natural guesses and rejects wrong ones", async () => {
    const { linkMatches } = await import("../src/match");
    const teeth = ["teeth", "tooth", "fangs", "tusks", "things with teeth"];
    for (const g of ["teeth", "they all have teeth", "Things with teeth!", "TOOTH", "they bite... teeth"]) expect(linkMatches(g, teeth), g).toBe(true);
    for (const g of ["", "sharp things", "animals", "things"]) expect(linkMatches(g, teeth), g).toBe(false);
    const secret = ["acronym", "named after", "eponym", "people"];
    expect(linkMatches("acronyms and people's names", secret)).toBe(true);
    expect(linkMatches("named after someone", secret)).toBe(true);
    expect(linkMatches("food", secret)).toBe(false);
  });
});
