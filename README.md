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
- `src/art/themes/<theme>.txt`: one file per daily theme. Each object is `@id | band | names` followed by shape lines in the drawing-board language (see `src/art/board.ts`). Themes take turns, one per day.
- `/board.html` (`npm run dev`, then open it): the drawing board. Edit a theme file and watch every sprite redraw.
- `scripts/themes/candidates.py <wordnet synset>`: lists candidate objects for a new theme with word-frequency scores (`pip install nltk wordfreq`).
- `scripts/art/render.mts` + `scripts/art/sheet.py`: render a theme file to a labelled PNG contact sheet, for review or blind naming tests.
- `src/match.ts`: answer matching (case, spaces, a/the, plurals, UK/US spellings, a leading colour/size word, one typo on listed names of 6+ letters). Names starting with `~` in objects.txt are accepted but never shown.
- `src/daily.ts`: date to puzzle number and the day's 40 objects. Each band walks a shuffled deck so objects don't repeat until the band is used up.
- `src/themes/`: the look. `pixel-space/` holds the palette, eyepiece drawing, starfield, sounds, CSS and sprite sheet. A new theme is a new folder plus one line in `src/themes/index.ts`.

## Credits
All object art is drawn for this game on the Stargazer drawing board. Fonts: Press Start 2P and VT323 (SIL Open Font License).

## Daily photo packs

A night can have its own photo set instead of the rotating theme. Packs are static files:

    public/days/<YYYY-MM-DD>/pack.json   # {date, theme: "photos", items: [{id, band 1-4, names[], note}]}
    public/days/<YYYY-MM-DD>/<id>.png    # plate strip, same format as src/art/photos

Build one from a generated batch (raw green-screen images named <id>.png plus the batch's items.json):

    python3 scripts/photos/make_day.py <images dir> <items.json> 2026-12-01 --skip=hurdygurdy,ayeaye

On that local date the game fetches `days/<date>/pack.json`; if it exists, tonight's star shows Photographs and
the sky is drawn from the pack (per-band counts from CONFIG.tiers, 3/8/12/6 for most players). No pack, no change.
Push the folder to `main` and Vercel redeploys. Note: future packs are public files, so a curious player could peek.
