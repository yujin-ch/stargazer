"""Candidate words for a theme: WordNet hyponyms of the theme's roots, scored by word frequency (Zipf).
Usage: NLTK_ALLOW_PROXIED_URLOPEN=1 python3 scripts/themes/candidates.py animal.n.01 [more synsets] > out.tsv"""
import sys
from nltk.corpus import wordnet as wn
from wordfreq import zipf_frequency

seen = {}
for root in sys.argv[1:]:
    for s in wn.synset(root).closure(lambda s: s.hyponyms()):
        for l in s.lemmas():
            w = l.name().replace("_", " ").lower()
            if any(c.isdigit() for c in w) or len(w.split()) > 2 or w[0].isupper() and False: continue
            if l.name()[0].isupper(): continue  # proper nouns
            z = zipf_frequency(w, "en")
            if z < 2.3: continue
            if w not in seen or seen[w][0] < z: seen[w] = (z, s.name())
for w, (z, s) in sorted(seen.items(), key=lambda kv: -kv[1][0]):
    print(f"{z:.2f}\t{w}\t{s}")
