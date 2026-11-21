# Quanah Hologram Solver

A browser tool for MapleStory **Event World: Quanah** that finds 18/18 Hologram skill sets on Libae's Supercharged Equipment from your own drops.

Open `index.html` in a browser. No build step and no install. Everything runs locally, and your inventory is saved in the browser's local storage.

## What it does

- **Line fodder**: log each Hat, Top, Bottom, Gloves, Shoes and Cape you farm for its 3 Hologram skill lines. Quick entry accepts shorthand such as `gloves dl wh cd`.
- **Socket bases**: a separate list for the pieces you farm for their jewel sockets (`hat p r g`). Each base is labelled (for example "All useful · 1 Prismatic + 2 stat"), and the tab picks the best base per slot for every build.
- **Scan screenshots**: drop, paste (Ctrl+V) or pick screenshots of item tooltips, choose whether they are line fodder or socket bases, then check and correct the result before it is added.
  - On the hosted claude.ai page, Claude reads the images on your own Claude account (you are asked once to allow it), including jewel socket colors.
  - Opened locally, `index.html` uses on-device OCR ([Tesseract.js](https://github.com/naptha/tesseract.js), loaded from jsDelivr on first use, about 5 MB) and fuzzy-matches the skill names. Socket colors are not detected there; fill them in during review.
- **Solve**: picks one piece per slot and scores the set against a target build (max 18). It lists:
  - exact 18/18 sets, including interchangeable item variants, with an Orb plan (which fodder's lines go onto which socket base);
  - the closest partial matches, with every line marked as counting, over the gear cap, or not part of the build, plus what is missing and which slot to replace with which 3 lines;
  - **One piece away**: the single pieces (slot + lines) that would finish an 18/18 with what you already own. These are your farming targets.
- **Check all presets**: runs every meta build at once and ranks them by how close your inventory is.
- **Import / Export**: JSON (inventory + settings) or CSV (`slot,line1,line2,line3,socket1,socket2,socket3,note,type` with type `fodder` or `base`; full skill names or codes).

## Safe to use while MapleStory is running?

The tool is a plain web page. It never reads game memory, watches your screen or keyboard, or sends input to the game; it only sees images you choose to give it. Take screenshots with the game's own screenshot key or Windows Snipping Tool (Win+Shift+S, then paste), not with overlay/recording tools that inject into the game client.

## Browsers

Works in current Firefox, Chrome and Edge. In Firefox, click the paste box on the Scan tab before pressing Ctrl+V.

## Builds

| Build | Lines | Prismatics |
|---|---|---|
| Traditional 18/18 | DL 3, WH 3, Registry 3, ATT 3, Crit Dmg 1, Warrior/Mage/Archer/Thief/Pirate 1 each | 4 |
| EU Build | DL 3, WH 3, Registry 3, ATT 3, Crit Dmg 3, Damage 3 | 6 |
| Modified Chinese | DL 3, WH 3, Registry 3, ATT 3, Crit Dmg 3, any 3 distinct class lines | 5 |
| Class-Specific (e.g. Shade) | DL 3, WH 3, Registry 3, ATT 3, Crit Dmg 3, Damage 2, own class 1 | 5 |
| Custom | any counts that add up to 18 (skills cap at 3, class lines at 1) | derived |

The header toggle swaps ATT Enhancement for M.ATT Enhancement for Magicians, and sets your own class line for the Class-Specific build.

## How the search works

Items in a slot with the same useful lines for the chosen build are merged, and pieces whose useful lines are a strict subset of another piece in the same slot are dropped (they can never score higher). A branch-and-bound search then walks the six slots, pruning any branch that cannot beat the current top results. Hundreds of pieces solve in well under a second; the search runs in a Web Worker so the page stays responsive.

## Development

```
npm test                 # solver unit tests (Node 18+), incl. a brute-force cross-check
npm run build:artifact   # writes dist/ for hosting as a claude.ai artifact
```

Files: `solver.js` (all game logic incl. the OCR text parser, browser + Node), `worker.js` (Web Worker wrapper), `index.html` (UI).
