# Stargazer

A daily one-minute picture-naming game. Look through a pixel telescope and type the name of each object that drifts by. Everyone gets the same 40 objects each day.

## Play rules
- 60 seconds. Type a name; it auto-advances on a match (no Enter).
- Tab or Skip moves on and costs 2 seconds. Esc clears.
- Objects 1-10: clear (1 pt). 11-25: start 2x zoomed, pull back over 3 s (2 pts, 3 if named while zoomed). 26-40: start 4x zoomed and out of focus, pull back over 4 s (3 pts, 5 zoomed).
- One scored run per day (saved in the browser, from the moment the shutter opens, so a reload can't buy a retry); practice skies are random and unscored.
- Steady hand: 3, 6 and 10 answers in a row earn +1, +2, +3 per answer. A skip breaks it.
- Name the whole sky early and every second left is a point.
- Streak tiers: Stargazer sky, Astronomer sky (3 nights in a row), Deep-sky hunter sky (7 in a row). Higher tiers mix in "Uncharted" niche objects. Everyone on the same tier gets the same sky.

## Develop
```
npm install
npm run dev      # local dev server
npm test         # matcher + library + daily-set tests
npm run build    # static site in dist/ (what Vercel serves)
```
Vercel: import the repo, framework preset "Vite" (build `npm run build`, output `dist`).

## Where things live
- `src/config.ts`: every tuning number (run length, skip cost, zoom, blur, points, launch date).
- `data/objects.txt`: the object library, one line per object: emoji | theme label | band | accepted names. Edit names here.
- `scripts/build_library.py`: turns `objects.txt` into `src/data/objects.json` and the sprite sheet. Needs the Twemoji SVGs (`npm pack @twemoji/svg`, unpack) plus `pip install cairosvg pillow`, then `python3 scripts/build_library.py <path-to-svgs>`.
- `src/match.ts`: answer matching (case, spaces, a/the, plurals, UK/US spellings, a leading colour/size word, one typo on listed names of 6+ letters). Names starting with `~` in objects.txt are accepted but never shown.
- `src/daily.ts`: date to puzzle number and the day's 40 objects. Each band walks a shuffled deck so objects don't repeat until the band is used up.
- `src/themes/`: the look. `pixel-space/` holds the palette, eyepiece drawing, starfield, sounds, CSS and sprite sheet. A new theme is a new folder plus one line in `src/themes/index.ts`.

## Credits
Object art: [Twemoji](https://github.com/jdecked/twemoji) © Twitter, Inc. and other contributors, licensed [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/), pixelated for this game. Fonts: Press Start 2P and VT323 (SIL Open Font License).
