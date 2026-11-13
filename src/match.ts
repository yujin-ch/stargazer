import { CONFIG } from "./config";

/** Lowercase, drop accents, punctuation, spaces and leading articles; fold UK spellings to US. */
export function normalize(raw: string): string {
  let s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  s = s.replace(/^(a|an|the|some|my)\s+/, "");
  s = s.replace(/\s+/g, "");
  return fold(s);
}

/** Spelling folds applied to both sides, so colour/color, theatre/theater, grey/gray all meet. */
function fold(s: string): string {
  return s
    .replace(/grey/g, "gray")
    .replace(/our/g, "or")
    .replace(/yse/g, "yze")
    .replace(/ise/g, "ize")
    .replace(/ae/g, "e");
}

/** Words people put in front of a name that shouldn't stop it counting. */
const DESCRIBERS = new Set(("red orange yellow green blue purple pink brown black white grey gray gold golden silver " +
  "big small little giant tiny baby cute old toy wooden metal plastic shiny happy cartoon pet wild farm").split(" "));

const IRREGULAR: Record<string, string[]> = {
  mouse: ["mice"], mice: ["mouse"], goose: ["geese"], tooth: ["teeth"], foot: ["feet"],
  person: ["people"], child: ["children"], die: ["dice"], dice: ["die"], cactus: ["cacti"],
  fungus: ["fungi"], octopus: ["octopi", "octopuses"], knife: ["knives"], leaf: ["leaves"], loaf: ["loaves"],
};

/** Accepted spellings of one alias: the alias itself plus plural and singular forms. */
export function forms(alias: string): string[] {
  const w = alias.toLowerCase().trim();
  const out = new Set<string>([w]);
  // plurals
  out.add(w + "s");
  if (/(s|x|z|ch|sh|o)$/.test(w)) out.add(w + "es");
  if (/[^aeiou]y$/.test(w)) out.add(w.slice(0, -1) + "ies");
  if (/f$/.test(w)) out.add(w.slice(0, -1) + "ves");
  if (/fe$/.test(w)) out.add(w.slice(0, -2) + "ves");
  // singulars, only for longer words so short prefixes never auto-accept
  if (w.length >= 5 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) {
    if (/ies$/.test(w)) out.add(w.slice(0, -3) + "y");
    else out.add(w.slice(0, -1));
    if (/(s|x|z|ch|sh)es$/.test(w)) out.add(w.slice(0, -2));
  }
  const last = w.split(" ").pop()!;
  for (const irr of IRREGULAR[last] ?? []) out.add(w.slice(0, w.length - last.length) + irr);
  return [...new Set([...out].map(normalize))].filter(Boolean);
}

/** Damerau-Levenshtein distance capped at 2 (enough to test "within one"). */
export function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diffs: number[] = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { diffs.push(i); if (diffs.length > 2) return false; }
    if (diffs.length === 1) return true;
    // one adjacent swap
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

export interface Match {
  /** The accepted form that was matched (normalized). */
  form: string;
  /** True when it matched only thanks to typo tolerance and is shorter than the real name,
   *  i.e. the player may still be typing the last letter. */
  early: boolean;
}

export interface Matcher {
  test(typed: string, names: string[]): Match | null;
}

/** Build a matcher that knows every object's names, so typo tolerance never steals another object's answer. */
export function makeMatcher(allNames: string[][]): Matcher {
  const everyForm = new Set<string>();
  for (const names of allNames) for (const n of names) for (const f of forms(n)) everyForm.add(f);
  const cache = new Map<string, string[]>();
  const formsOf = (names: string[]) => {
    const key = names.join("|");
    let f = cache.get(key);
    if (!f) { f = [...new Set(names.flatMap(forms))]; cache.set(key, f); }
    return f;
  };
  return {
    test(typed, names) {
      const t = normalize(typed);
      if (!t) return null;
      const mine = formsOf(names);
      if (mine.includes(t)) return { form: t, early: false };
      // "brown dog", "golden key": drop one leading describing word if the rest is a real name
      const words = typed.toLowerCase().trim().split(/\s+/);
      if (words.length > 1 && DESCRIBERS.has(words[0])) {
        const rest = normalize(words.slice(1).join(" "));
        if (mine.includes(rest)) return { form: rest, early: false };
      }
      if (t.length < CONFIG.typoMinLength - 1) return null;
      const mineSet = new Set(mine);
      if (everyForm.has(t) && !mineSet.has(t)) return null; // it's another object's real name
      // typo targets are the listed names only, not generated plurals ("swords" must not catch "words")
      for (const n of names) {
        const f = normalize(n);
        if (f.length >= CONFIG.typoMinLength && withinOne(t, f)) return { form: f, early: t.length < f.length };
      }
      return null;
    },
  };
}

const LINK_FILLER = new Set("the a an of and or with that they all are is it its things thing stuff tonights tonight objects object have has had who which what were was be for in on to".split(" "));

/**
 * Does a Mystery link guess find the theme? True when the guess contains one of the theme's key
 * phrases, or any key word (ignoring filler like "things with"), allowing plurals and one typo on long words.
 */
export function linkMatches(guess: string, keys: string[]): boolean {
  const words = (s: string) => normalizeWords(s).filter((w) => !LINK_FILLER.has(w));
  const g = words(guess);
  if (!g.length) return false;
  const gs = " " + g.join(" ") + " ";
  for (const k of keys) {
    const kw = words(k);
    if (!kw.length) continue;
    if (kw.length > 1 && gs.includes(" " + kw.join(" ") + " ")) return true;
    if (kw.length === 1) {
      const kf = new Set(forms(kw[0]));
      for (const w of g) {
        if (forms(w).some((f) => kf.has(f))) return true;
        if (w.length >= 6 && kw[0].length >= 6 && withinOne(w, kw[0])) return true;
      }
    }
  }
  return false;
}

function normalizeWords(s: string): string[] {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}
