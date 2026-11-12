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
    .replace(/tre$/g, "ter")
    .replace(/ae/g, "e");
}

const IRREGULAR: Record<string, string[]> = {
  mouse: ["mice"], mice: ["mouse"], goose: ["geese"], tooth: ["teeth"], foot: ["feet"],
  person: ["people"], child: ["children"], die: ["dice"], dice: ["die"], cactus: ["cacti"],
  fungus: ["fungi"], knife: ["knives"], leaf: ["leaves"], loaf: ["loaves"],
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
    out.add(w.slice(0, -1));
    if (/ies$/.test(w)) out.add(w.slice(0, -3) + "y");
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
      if (t.length < CONFIG.typoMinLength) return null;
      const mineSet = new Set(mine);
      if (everyForm.has(t) && !mineSet.has(t)) return null; // it's another object's real name
      for (const f of mine) if (f.length >= CONFIG.typoMinLength && withinOne(t, f)) return { form: f, early: t.length < f.length };
      return null;
    },
  };
}
