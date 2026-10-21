# The sheet layout — block cutting, and how RoofMap does it

Written 2026-10-21, when the Sheet layout picture came back after five weeks
hidden, and rewritten the same day when the owner threw the first rebuild
out. Half of this is what AppliCad Roof Wizard does (researched that day
from its help pages, the 2017 Block-Cutting tutorial and the AU/NZ
manufacturers' estimating guides; the applicad.com hosts themselves are
refused by the cloud container's proxy, so it was read through search
extracts — quotes are snippet-level, nothing was read end to end). The other
half is how `_sheetPuzzleBuild` / `_renderSheetPuzzleCanvas` in
`frontend/sheet-plan.js` draw the roof, and what is deliberately NOT done
yet.

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

## 3. How RoofMap draws it — the puzzle first, the fill later

The first rebuild (the morning of 2026-10-21, commit `fcaab9a`) drew the
picture FROM THE ENGINE'S SECTIONS — the same columns the calc check tiles —
and cut each column at the roof lines. The owner looked at it and said:

> "Boy oh boy it's very wrong! Don't try to use my sheet calculation method,
> alot of it's wrong anyway so start fresh, i want a full new build, start by
> dividing the roof inside sheet width without filling any colour yet, lets
> make the puzzle then fill it afterwards, remember every sheet must run
> perpendicular to the gutter/ridge lines and they are allow to run 45deg to
> a hip or valley only, sheet must never run parralell to the gutter or
> ridge, sheets (colours) must also never run past any roof line (also for
> later when we start to fill the puzzle with sheets, sheets must always be
> ordered with a square cut edge, the sheet gets cut at the hips or valleys
> and the offcut must be spun to he used somewhere, it can never be flipped
> over)"

So the picture is built from the roof's own geometry and reads NOTHING from
the counting pass. Two steps, and only the first is built:

### Step 1 — the puzzle (`_sheetPuzzleBuild`, built)

1. **Faces.** The outline's edges and the drawn roof lines that CUT the roof
   (ridge, hip, valley, apron, change of pitch; a gutter or barge lies on the
   outline and cuts nothing, and so does a line drawn along a wall) are
   split wherever they cross or where one ends on another, their ends are
   noded (within `tol`, a fifth of a sheet cover capped at 8 px), and the
   planar graph is walked face by face (sorted neighbours, next edge
   clockwise). The outer loop is the biggest and is dropped; dangling edges
   fold out as back-and-forth spikes; anything left with no area is dropped;
   a face has to sit inside the outline. The west slope of an L's wing and
   its main come out as ONE face, because they are one plane — the picture
   says so and the sheets run straight through, which is right.
2. **Which way the sheets run.** Each face takes a REFERENCE edge: its
   longest gutter; a face with no gutter (the band above a change of pitch)
   its ridge; failing that an apron or the change-of-pitch line, which are
   level lines too. The sheets run along the inward normal of that edge —
   square to the gutter and the ridge by construction, never parallel to
   either, and at 45° to an equal-pitch hip or valley because that is where
   those lines lie. The picture draws an arrow per face so this can be
   checked by eye.
3. **Strips.** The face is divided into strips one sheet cover wide
   (`#sheetWidth`, 762 mm by default) along the reference, starting flush
   at the face's barge where it has one (a gable end is where the first full
   sheet goes; a barge at the far end lays the strips from that end). Each
   strip is the convex rectangle clipped against the face polygon
   (`_ccClipToConvex`), so a piece is exactly the shape the roof lines cut
   it to and NEVER runs past one. The last strip of a face is whatever is
   left (18 m ÷ 0.762 = 23.6: 23 full strips and a 0.47 m closer).
4. **Lengths.** A piece's LONG edge (its extent up the slope) is the length
   it must be cut from, its SHORT edge is the other strip edge (0 for a
   triangle's tip), both at the pitch (`1/cos`, the lower pitch for the band
   below a change of pitch). The width is recorded too, for the fill.

What it does not do: colour, number or group anything. A piece is a white
shape with its long length written up it, a face is F1, F2 … in reading
order with its arrow, and the footer lists each face's pieces, gutter length
and longest piece. That is the whole of step 1, and it is what the owner
asked to see before anything was filled in.

### Step 2 — the fill (NOT built; the owner's rules, so they are not lost)

- Every sheet is ORDERED with a square cut edge (the gutter end, and the
  ridge end on a full strip).
- The sheet is cut at the hips and valleys — the diagonal is the only cut
  that is not square.
- The offcut is SPUN to be used somewhere else: rotated 180° in the plane of
  the roof. It is NEVER flipped over (a mirror image), because a roofing
  sheet has a top face and a lap side.
- Hence on an equal-pitch hip the offcut of the k-th sheet from a hip, spun,
  is the k-th piece of the OPPOSITE slope's hip end at the same corner (not
  the same slope's — that would need a flip). Colour (= order group) and
  sheet number come with this step.

The pieces already carry what the fill needs: face, strip index, width,
long and short edge, whether the strip edge is a tip, and which roof line
each face edge is.

`_renderSheetPuzzleCanvas({thumb, roofIdxs, lines})` draws it in the calc
check's 960-wide frame (1× for the side card, 2× for the page and the PDF).
The Maps panel, the Sheet layout page type and the combined all-roofs
capture all render from it (`_jpCaptureSheetPlan`,
`_jpCaptureSheetPlanCombined` — every ticked roof in ONE frame now, since
they share the drawing's coordinates — and `_jpRenderSheetPlan`). The live
card passes `roofIdxs:[-1]` and the ORIGINAL lines, because the counting
pass borrows `DRAW.lines` while it works. `window._lastSheetPuzzle` is the
last build, for the suite. `tests/sheetlayout.mjs` (66) pins the rules face
by face on the plain hip, the gable, a change of pitch, the Big-L, the dutch
and the owner's hand-counted fixtures: every face off a gutter, square to
gutter and ridge, 45° to hip and valley, no piece across a roof line, the
roof covered exactly once, every strip one cover wide but the last.

The first rebuild's block-cut code is gone from the tree; `fcaab9a` is the
commit that carried it, and the picture before that (the per-roof-type
cascade) is saved in `docs/legacy-sheet-layout-draw.js`, last live at
`b81e5c5`. `_ccColumnsFor` / `_ccNumberColumns` stay in sheet-plan.js
because the calc check tiles its columns through them.

## 4. Open, and the owner's to call

- **The fill** (step 2 above) — colour, numbering, offcut pairing, the
  order groups. Waits on the owner approving the puzzle.
- **Lay direction.** AppliCad starts "from the longest gable line on the
  roof plane … laying away from a gable end" and marks the lap side. The
  strips start at a barge where there is one, else at the face's left/top
  end; the arrow shows the up-slope direction only.
- **Valleys.** The engine's +1 spare per valley wing is a COUNT rule; the
  puzzle shows the valley triangle as the piece it is. Whether the fill
  pairs valley offcuts across the two wings (Block-Cut's valley flip) or
  keeps the spare is the owner's call.
- **Overhang into the gutter** is not added to any length.
- **The T gable** (a plain gable on a T outline) is drawn faithfully from
  the lines the gable builder gives it, which are the builder's problem, not
  the puzzle's.
