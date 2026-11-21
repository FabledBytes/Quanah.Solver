# Quanah Hologram Solver

A browser tool for MapleStory **Event World: Quanah** that finds 18/18 Hologram skill sets on Libae's Supercharged Equipment from your own drops.

Open `index.html` in a browser. No build step and no install. Everything runs locally, and your inventory is saved in the browser's local storage.

## What it does

- **Inventory**: log each Hat, Top, Bottom, Gloves, Shoes and Cape with its 3 Hologram skill lines and (optionally) its 3 jewel sockets. Quick entry accepts shorthand such as `gloves dl wh cd p r g`.
- **Solve**: picks one piece per slot and scores the set against a target build (max 18). It lists:
  - exact 18/18 sets, including interchangeable item variants;
  - the closest partial matches, with every line marked as counting, over the gear cap, or not part of the build, plus what is missing and which slot to replace with which 3 lines;
  - **One piece away**: the single pieces (slot + lines) that would finish an 18/18 with what you already own. These are your farming targets.
- **Check all presets**: runs every meta build at once and ranks them by how close your inventory is.
- **Socket bases**: picks the best socket base per slot for each build (one Prismatic per maxed skill, colored stat jewels for the rest; extra Prismatics and off-color sockets count as waste). Line fodder and socket bases are separate pools: once the lines make 18/18, transfer them onto the bases with Orbs.
- **Import / Export**: JSON (inventory + settings) or CSV (`slot,line1,line2,line3,socket1,socket2,socket3,note`; full skill names or codes).

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

Files: `solver.js` (all game logic, browser + Node), `worker.js` (Web Worker wrapper), `index.html` (UI).
