# The sheet layout — block cutting, and how RoofMap does it

Written 2026-10-21, when the Sheet layout picture came back after five weeks
hidden. Half of this is what AppliCad Roof Wizard does (researched that day
from its help pages, the 2017 Block-Cutting tutorial and the AU/NZ
manufacturers' estimating guides; the applicad.com hosts themselves are
refused by the cloud container's proxy, so it was read through search
extracts — quotes are snippet-level, nothing was read end to end). The other
half is how `_sheetLayoutBuild` / `_renderSheetLayoutCanvas` in
`frontend/sheet-plan.js` map onto it, and where they deliberately do not.

## 1. What the trade actually orders (the rule everything rests on)

On an equal-pitch hip roof every hip sits at 45° in plan. A sheet running up
a long slope into a hip is cut on the diagonal; the triangle cut off is the
mirror image of the triangle the hip END needs directly opposite. So the
trade orders **every slope at one length — the full ridge-to-gutter run —
across the whole eave**, and the hip ends are sheeted from the offcuts with
nothing extra ordered. Metroll's roofers' guide puts it in one worked example:
22 m eave ÷ 0.762 cover = 29 sheets a side, "58 sheets at 4570 mm", and
"ordering the sheets at one length will eliminate wastage … the surplus
sheeting can be used on the reverse corner of the roof".

That is the owner's counting rule (each roof counts its OWN gutter ÷ cover,
rounded up from a tenth of a sheet; the hip ends are cut from the same
sheets), and it is what the engine's **sections** already are. The arithmetic
is exact: a W × D hip roof has 2·(W−r)·r of long-slope area and 2·r² of end
area (r = D/2), which add to W·D — precisely the 2·W·r of steel that
2·⌈W/cover⌉ sheets of length r supply.

## 2. AppliCad's four methods, by name

| Method | What it produces |
|---|---|
| **Gen-Panels / Tally-Panels** | One panel per strip, long point to long point; "the triangular section at the end of each piece is deemed as waste" — the worst case. Short panels below the profile's minimum are combined into longer sheets. |
| **Auto-Block 1 / Auto-Block 2 ("Blocking")** | Rectangles of N sheets × one length. Auto-Block 2 "presumes that all triangle areas have a corresponding and matching off-cut triangle" and builds its blocks "based upon the ridge lines — each ridge gets two blocks, one on each side, extending as far as the roof geometry allows". |
| **Gen-Offcuts** | "Flip-flopping triangles of material" automatically; superseded by Block-Cut. |
| **Block-Cut** | The current one. Takes the blocks and lets the estimator sub-divide each into **block-pieces** (A1, A2 …), assign each roof-plane area to a piece, split a plane at a point / distance / mirror, and rotate a piece (F1/F2) "until it fits in place on our block taking note of the panel lay direction". One colour per block; the installer gets "a color-coded placement drawing that maps each panel and offcut to a numbered roof section". It is **interactive** — "may result in multiple 'correct' results". |

Rounding is where its counts move: *Round Panels in Each Block* (6.6 + 5.3
panels → 7 + 6 = 13, safe) against grouping first (→ 12, "no margin for
error on site"); *Round-Off Sheets to Next (mm)*; and an eave check (never
more sheets than total eave ÷ cover). RoofMap rounds **per block**, per the
owner, with the tenth-of-a-sheet tolerance (`_sheetsAcross`).

Sheet lengths run "from the geometric model and then the allowances such as
'distance from true ridge line' and 'gutter overhang' are factored in. Then
any rounding or max/min sheet lengths are applied". AppliCad publishes no
numeric defaults for those; NZ practice is 50 mm into the gutter (NZMRM
COP: 40–70 mm by pitch, 150 mm max on corrugate). RoofMap's ordered length
is the full run as drawn (`SHEET_LENGTH_INSET_M` = 0); the overhang is the
office's to add in the Material calculations page if they want it.

## 3. How RoofMap draws it

`_sheetLayoutBuild(sections)` reads **the same sections** the Sheet calc
check and the SHEETS TO ORDER legend read (`window._lastSheetSections`), so
the three cannot disagree about a count, a length or a colour. The old
picture had its own face-finder, its own colours and its own numbering, and
the owner withdrew it on 2026-09-14 because all three disagreed with the cut
list on every L and T in the fixtures.

1. **Columns** — `_ccColumnsFor(secs)` tiles each section's columns with the
   calc check's own anchoring (the main from its obU0, a wing flush to the
   edge farthest from the main); `_ccNumberColumns` numbers them (each
   ordered length from 1, main before wing, the two slopes carrying
   through). Both helpers are shared with `_renderCalcCheckCanvas`, so
   sheet 12 is sheet 12 on either picture.
2. **Blocks** — every (section, slope) is a block lettered A, B, C … in
   numbering order: Auto-Block 2's "two blocks per ridge".
3. **Pieces** — each column is read along seven rays across its width. A
   sheet stands on its eave, so a column whose foot is on a real eave (an
   outline edge running along the ridge) is read UP from there to the first
   roof line — hip, valley, ridge, apron, change of pitch — or the roof's
   edge. Where the eave is phantom (the foot lands inside another block's
   footprint — the main's slope under a wing) the column is read DOWN from
   its ridge. A column standing on neither but inside the roof (the engine
   counts it — a T's bar over its stem) is drawn where the engine puts it.
   Outside the roof altogether it is a rounded-up sheet nothing can place,
   and the footer says so. The cut edge is kept as a polyline, so a hip
   entering a column part-way reads as the kink it is.
4. **Lengths** — a piece's cut length is its LONG edge (what the sheet must
   be cut to); its offcut is the sheet less its SHORT edge (the trapezoid a
   diagonal cut leaves). Even a sheet ordered full leaves a triangle when a
   hip clips its corner.
5. **Hip ends** — a hip springing from the ridge (or from the ridge level,
   on a pyramid with no ridge line) and falling to an eave corner makes a
   half end-face: the triangle between that hip, the end eave and the ridge
   level, one per slope. It is tiled with strips parallel to the ridge; the
   k-th strip from the apex is the mirrored offcut of the k-th column from
   that end on the same slope, and the piece records whether that offcut is
   long enough (`fits`). Equal pitches match exactly; the schedule says
   "short" when they do not. A hip to another ridge's end is a junction and
   makes no end face; an L's main therefore has only its lower half at the
   wing end. An end already sheeted by another section (a dutch gablet) is
   left to it.
6. **Valley spares** — the engine's "+1 of the longest length per valley
   wing" is drawn as a hatched spare after the last column where it lands on
   the roof, and listed either way.

What stays uncovered on the picture is deliberate: the triangle under a
valley on an L (the engine's +1 valley spare is for exactly that), and the
odd faces of hand-drawn skeletons that the engine squares off. The picture
tells the truth about where the counted sheets go; it never invents a sheet
the count does not have.

`_renderSheetLayoutCanvas(sections, {thumb})` draws it in the calc check's
frame: order-group chips, the roof with every piece coloured by ordered
length, hatched end pieces named "↺12" for the sheet they are cut from, the
roof lines in the map's colours, a block letter per block, and a BLOCK CUT
SCHEDULE under it — one line per block: `A main · lower slope — 14 × 5.39 m:
1–10 full · 11 cut 4.21 (↺ 1.18) · …`. The Maps panel, the Sheet layout page
type, the combined all-roofs capture and the hidden legacy card all render
from it (`_jpCaptureSheetPlan`, `_jpCaptureSheetPlanCombined`,
`_jpRenderSheetPlan`).

## 4. Open, and the owner's to call

- **The valley flip.** Block-Cut routes a main's valley-cut offcuts onto the
  wing's own valley cuts (and vice versa). The engine covers the imbalance
  with one spare sheet per valley wing rather than pairing pieces; the
  picture shows each side's cut lengths and leaves the pairing to the crew.
- **Lay direction.** AppliCad starts "from the longest gable line on the roof
  plane … laying away from a gable end" and marks the lap side. The numbering
  here starts at the calc check's anchor; a lay-direction arrow per block is
  a small addition if the crews want one.
- **Gen-Panels' per-strip list** (every strip at its own length, nothing
  reused) is the worst-case figure some suppliers quote against. The pieces
  carry every length needed to print it; nothing does yet.
- **Overhang into the gutter** is not added to the ordered length.
