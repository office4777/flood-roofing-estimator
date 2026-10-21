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
   it to and NEVER runs past one. Every sheet is a full sheet: where a run
   does not divide (18 m ÷ 0.762 = 23.6) the remainder is a full-width sheet
   at the far corner that LAPS its neighbour (0.47 m showing, 0.29 under),
   never a sheet ripped narrow — each piece records what shows (`widthMm`)
   and the lap (`lapMm`); its cut geometry comes from the whole sheet.
4. **Lengths.** A piece's LONG edge (its extent up the slope) is the length
   it must be cut from, its SHORT edge is the other strip edge (0 for a
   triangle's tip), both at the pitch (`1/cos`, the lower pitch for the band
   below a change of pitch). The width is recorded too, for the fill.

What it does not do: colour, number or group anything. A piece is a white
shape with its long length written up it, a face is F1, F2 … in reading
order with its arrow, and the footer lists each face's pieces, gutter length
and longest piece. That is the whole of step 1, and it is what the owner
asked to see before anything was filled in.

### Step 2 — the fill (`_sheetPuzzleFill`, built the same afternoon: "Try to use roof wizards logic and methods")

The owner's rules for it, in his words: every sheet is ORDERED with a square
cut edge; the sheet is cut at the hips and valleys; the offcut is SPUN to be
used somewhere else — rotated in the plane of the roof, never flipped over
(a roofing sheet has a top face and a lap side). Roof Wizard's Auto-Block 2 /
Block-Cut, mapped onto the puzzle:

1. **Blocks (Auto-Block 2).** A face with at least one FULL strip (square at
   both ends) is ordered as blocks, every sheet in a block at ONE length —
   the longest piece in it, rounded up to 10 mm (`_PZ_ROUND_MM`; Roof
   Wizard's "Round-Off Sheets to Next (mm)"). "Each ridge gets two blocks,
   one on each side": the full strips are grouped by the level they top out
   at, and a cut strip joins the longer neighbouring level PROVIDED it is no
   longer than that level's sheets — it is then that block's hip or valley
   cut. Rounding is per block, never grouped first (AppliCad's own warning).
2. **Where the strips start** is decided in the builder, because it is what
   makes the offcuts match, and since 2026-10-22 it is the plain hip's rule
   run on the RECTANGLE a face belongs to (the owner: "imagine the L-shape
   and a rectangle … run the exact same logic as the plain hip … using the
   offcuts in the same locations … the Big L's outline and lines like a
   cookie cutter"):
   - flush at a barge (a gable end is where the first full sheet goes);
   - a hip END — one vertex at the top with a hip each side, at least one
     running down to the gutter — from its APEX, so each half's k-th strip
     from the apex is the exact spun offcut of the k-th sheet from the
     corner on the slope opposite. That holds even when a wing's ridge
     stands on the same plane: an L's west face is the main's hip end AND
     the wing's slope, and is anchored at the main's apex;
   - a slope between two hips: ONE run of full-width sheets along the whole
     side of its rectangle — the gutter followed through the roof
     (`_pzVirtualSpan`), so an L's main slope is laid along the 18 m, not
     the 12 m the wall shows — from the WORLD-LOW corner, the plain hip's
     own, agreed across every parallel slope of the roof (so the hip end
     between two slopes is fed from both sides with the same exact
     offcuts), unless no parallel slope has a real corner there (a T's
     stem has both slopes under the bar at one end and runs from the free
     end); the remainder lands at the far hip corner as a lapped full
     sheet. The owner on the old mirror split's narrow mid-face closer:
     "must always be full width sheets … force all sheets across to the
     edges which would make a larger offcut." The lapped corner sheet IS
     the mirror split's corner sheet, so the far hip end still gets its
     exact offcuts and the 18 × 12 m hip still closes at 48;
   - THE COOKIE CUTTER. A hip end that faces the same way as a slope,
     stands in front of that slope's gutter line inside its rectangle, and
     is at least a sheet narrower on each side (an L's wing end in front of
     the main's north slope) does not get its apex: it takes the SLOPE'S
     columns (`lay = 'grid'`, `f.template`, `f.grid`). The geometry that
     makes this free: the valley and the wing's hip are parallel 45° lines
     exactly the wing's length apart, so in each column the slope's piece
     between the valley and the hip, and the end's piece between its gutter
     and its hip, add up to the plain hip's own column sheet. The owner's
     three sketches over the plain hip say exactly this: the main rectangle
     laid as the plain hip, the red north-west corner pushed 6 m north by
     the valley onto the small north face, and the purple top strips of the
     west end pushed up with it onto the top of the wing's west slope. A T's
     bar beside a stem of about the same size is not sliced: within a sheet
     of each other, the plain hip's own offcuts fit its ends exactly, and
     that is the T the owner called 95% right.
3. **Offcuts.** A block sheet cut once leaves a trapezoid: short side
   (ordered length − the piece's long edge), long side (ordered − the
   piece's short edge), the diagonal's slope read off the cut edge itself,
   and a HAND — looking from the square end to the diagonal, is the long
   side on the left or the right. A sheet whose top is part ridge, part hip
   leaves only the triangle the hip spans, not a full-width trapezoid. It
   goes into the pool under its donor's number, with its face and the hips
   and valleys it is cut by (`touch`). A sheet cut at BOTH ends (an L's
   north slope beside the wing: the valley at its foot, the hip at its
   head) is one sheet in two places when the fill's step 0 finds the end's
   piece under it in the same column (`tiles`: square at the eave, the
   lower piece's top cut meeting the upper's bottom cut edge for edge, in
   each face's own eave coordinates): the top piece is the sheet, joins the
   slope's block and leaves only the offcut above the hip — the plain hip's
   own; the piece under it is its FOOT (`✂C5`, `strungTo`), carried along
   the column, drawn in the block's tint with a dashed edge, and costs
   nothing. A column with only the end's piece is the plain hip's corner
   sheet slid north whole (`viaTemplate`), ordered in the slope's block.
   Where the chain test fails nothing is strung and the sheet gives its two
   offcuts as before.
4. **Ends.** Which cut strips are the rectangle's own sheets and which come
   from the pool: on a slope, the strips cut at its REAL corners are block
   sheets (their offcuts feed the hip ends); the strips beyond its own
   gutter under the main (a wing slope's valley end) try the pool FIRST and
   fall back on the block — the owner: "the orange sheets at the hip are
   full length and cut into a triangle by the hip, then the offcuts get
   placed on the same face at the valley … so the number of orange sheets =
   the length of that gutter divided by sheet width" (8 on the Big-L's
   wing, where 12 were ordered before); on a hip END that also carries a
   run of full sheets (the L's west face) every cut strip is an end piece
   from the pool with the block as fallback, which is how the strips at the
   top of the wing's slope come from the south slope's D6–D9. A hip-end
   face is sheeted from the pool outright. The fit is: same hand — a spin
   keeps it, only a flip would change it — and the offcut must CONTAIN the
   piece with their square ends together (its short side ≥ the piece's
   short side, its long side ≥ the piece's long side). Every feasible pair
   is scored and the best pair on the whole roof settled first. THE SCORE:
   where the offcut BELONGS comes first (`home`: its sheet is cut by a hip
   or valley of the face being fed, or lies on that face — 600 for a hip
   end's claim, 300 for a pool-first valley piece's, so a slope's valley
   pieces never starve the end beside it, which has no other source), then
   the fit's surplus, then 0.04 mm per mm of distance. Distance alone was
   the first version and is the wrong guide: an end's strips travel the
   whole end face, past sheets of the OTHER end that happen to lie nearer.
   So a hip end's half nearest the FRONT slope is cut from the BACK slope's
   sheets, and vice versa — the crossing is what "never flipped" forces,
   and it is Auto-Block 2's "corresponding and matching off-cut triangle".
   A corner sliver under a third of a sheet each way (the EXPOSED length,
   not the lapped sheet's) is a SCRAP trimmed off the nearest offcut
   without consuming it, on a block face too. A pool-first strip nothing
   fitted joins its block and its offcut joins the pool, and the needs
   still open get a second pass (a bar end's corner piece off the bar's own
   valley-cut sheet). What nothing fits after that is ordered as an extra
   at its OWN length (the Big-L: one 3.52 m strip where the wing's ridge
   meets the main's hip, which no plain-hip offcut is shaped for).
5. **Tally (Tally-Blocks).** Sheets to order per length, the blocks under
   it, how many end pieces the offcuts covered, how many sheets were ordered
   extra because no offcut fitted, and how many offcuts are left over.

On the shapes in the suite: the 18 × 12 m hip is 2 × 24 at 6.63 m, all 32
hip-end pieces from offcuts, two slivers over; the gable 2 × 24, nothing
cut; the dutch four blocks (the gablet ends have full sheets against the
apron, so they are blocks, and the long faces' hip offcuts go unused); the
Big-L 64 — 48 × 7.73, 15 × 3.32 and one 3.52 extra; the wing's end wholly
out of the north slope's sheets (C1–C4 whole, the feet of C5–C8); the west
end's south half from C9 down to C1, its north half from D1–D5, its top from
D6–D9; the east end from D16–D24 and C24–C16; the wing's slope 8 with its
valley from its own four hip offcuts; six offcuts over — where the apex-laid
wing cost 78 and the engine's legend says 66; the T 78 (was 80), every end
piece from offcuts. The picture says all of this in its footer; a count the
engine's SHEETS TO ORDER legend gives is a different number worked a
different way, and the two are not reconciled — that is the owner's call.

`_renderSheetPuzzleCanvas({thumb, roofIdxs, lines})` draws it in the calc
check's 960-wide frame (1× for the side card, 2× for the page and the PDF).
The Maps panel, the Sheet layout page type and the combined all-roofs
capture all render from it (`_jpCaptureSheetPlan`,
`_jpCaptureSheetPlanCombined` — every ticked roof in ONE frame now, since
they share the drawing's coordinates — and `_jpRenderSheetPlan`). The live
card passes `roofIdxs:[-1]` and the ORIGINAL lines, because the counting
pass borrows `DRAW.lines` while it works. `window._lastSheetPuzzle` is the
last build, for the suite. `tests/sheetlayout.mjs` (110) pins the rules face
by face on the plain hip, the gable, a change of pitch, the Big-L (the exact
label sequence of both hip ends, the cookie cutter's feet tiling with their
sheets), the T (its bar ends keep their apex), the dutch and the owner's
hand-counted fixtures: every face off a gutter, square to
gutter and ridge, 45° to hip and valley, no piece across a roof line, the
roof covered exactly once, every strip one cover wide but the last.

The first rebuild's block-cut code is gone from the tree; `fcaab9a` is the
commit that carried it, and the picture before that (the per-roof-type
cascade) is saved in `docs/legacy-sheet-layout-draw.js`, last live at
`b81e5c5`. `_ccColumnsFor` / `_ccNumberColumns` stay in sheet-plan.js
because the calc check tiles its columns through them.

## 4. Open, and the owner's to call

- **Which count is the order** — the engine's legend (`_lastSheetCounts`,
  the cut list, the Fergus push) or the puzzle's tally. They differ on
  every L and T; the puzzle is honest about what the offcuts cannot cover.
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
