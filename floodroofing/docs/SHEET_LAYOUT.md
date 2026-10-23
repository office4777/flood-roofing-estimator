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
     the 12 m the wall shows — from the END THE WING IS AT when the cookie
     cutter has cut a wing there (`T.adoptLo/adoptHi`, decided after
     adoption), so the wing's whole sheets and feet are the plain hip's
     own exact columns whichever end it stands at (the mirrored L is the
     L to the sheet); with wings at both ends or neither, from the
     WORLD-LOW corner, the plain hip's own — agreed across every parallel
     slope of the roof (so the hip end between two slopes is fed from
     both sides with the same exact offcuts), unless no parallel slope
     has a real corner there (a T's stem has both slopes under the bar at
     one end and runs from the free end); the remainder lands at the far
     hip corner as a lapped full sheet. A face's gutter is EVERY gutter
     edge on its reference line, not the longest (a cross has a wing
     standing in the middle of each slope, and the wall either side of it
     is one gutter with two real corners). The owner on the old mirror split's narrow mid-face closer:
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
   goes into the pool under its donor's number, with its face and the hip
   or valley that CUT IT — the top offcut carries the edge at the sheet's
   head, the bottom offcut the edge at its foot (`touchTop` / `touchBot`;
   a sheet cut by a hip above and a valley below leaves two offcuts that
   belong in two places). A sheet cut at BOTH ends (an L's
   north slope beside the wing: the valley at its foot, the hip at its
   head) is one sheet in two places when the fill's step 0 finds the end's
   piece under it in the same column (`tiles`: square at the eave, the
   lower piece's top cut meeting the upper's bottom cut edge for edge, in
   each face's own eave coordinates): the top piece is the sheet, joins the
   slope's block and leaves only the offcut above the hip — the plain hip's
   own; the piece under it is its FOOT (`✂C5`, `strungTo`), carried along
   the column, drawn in the block's tint with a dashed edge, and costs
   nothing. A column with only the end's piece is the plain hip's corner
   sheet slid north whole (`viaTemplate`), ordered in the slope's block —
   unless the column is CLIPPED at the wing's own corner (a cross's wing
   stub, 0.57 m wide): that stub is cut from an offcut, never a whole
   sheet. A wing standing at the far END of the rectangle (a Z's east
   wing) takes the plain hip's lapped corner sheet on its own corner
   column (`f.endLo/endHi`: the wing's corner is at the rectangle's end),
   so its offcut is a whole sheet's width; a wing corner mid-rectangle is
   the hip's foot on the slope and is never lapped. Where the chain test
   fails nothing is strung and the sheet gives its two offcuts as before.
   The fit tolerance is `_PZ_FIT_MM` (25 mm): the roof lines come off the
   skeleton in pixels, and a corner a lap short is under the lap.
   EVERY L, AND THE TWO-WING ROOF (2026-10-22, the owner: "used same
   logic/mechanics on different sizes and orientations of the l-shape
   making sure the logic hold, also the same logic should transfer to a
   both with a wing off the top and the buttom of the main plain hip"),
   pinned in `tests/sheetlayout.mjs`: the Big-L mirrored, turned and with
   its wing off the bottom are each 48 × 7.73 + 16 × 3.32 (the 16th the
   B sheet heading the top run, the owner's "7th B next to B6"; the
   junction strip is cut straight and takes D6 — see THE STRAIGHT CUT
   below), the wing's end `1,2,3,4,✂5,✂6,✂7,✂8` whichever
   letter the block carries; a 24 × 12 L with a 4 × 8 wing cuts three
   whole sheets and two feet; a 10 m wing on a 14 m main is still cut
   (seven whole, six feet) and a 13 m one is within a sheet and keeps its
   apex; wings off the top AND the bottom at the west end cut both (four
   whole, four feet each), the main's west hip end between the two wing
   slopes still anchored at its apex (its hips stop at the wings' ridges
   half the depth down — `isApex`'s half-depth rule — which is a hip end
   and not the bump a wider wing's ridge makes), 48 × 7.73 + 32 × 3.32
   with nothing pushed in; a cross (a wing mid-slope both
   sides) cuts both wing ends as seven feet and two stubs from offcuts, 81
   sheets and nothing extra; a Z (wings at opposite ends) cuts both, the
   east wing's corner column lapped, 81 sheets: a sheet pushed in at the
   east apex (because the east wing takes a hand of the offcuts that end
   would have had on the plain hip — the geometry, not a miss) and the
   east wing's clipped corner stub ordered at its own 1.16 m.
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
   short side, its long side ≥ the piece's long side).
   THE SERIES (2026-10-22, the owner on the 10 m wing: "the blue B7 sheet
   should be a green offcut, if the green offcuts couldn't make it all the
   way to the end then a 7th Blue B sheet should be used next to B6 to
   push the green offcuts outwards … orange offcuts A5 & A6 in the bottom
   left corner should have been purple offcuts to the sheets C8 & C9,
   again if the offcuts are too short … add another full sheet in the
   middle of the apex to push all the offcuts down one making them
   longer"; and on the Z: "the green offcuts D18, D17, D16, they should
   actually be the offcuts to the red sheets F5, F6, F7, and F8"). Each
   SIDE of an end face — the hand tells the two halves of a hip end apart,
   and a slope's valley run is a side too — is fed IN ORDER
   (`seriesFeed`): its pieces longest first (the apex outward), its HOME
   offcuts biggest first, one to one, the plain hip's own pairing. WHERE
   AN OFFCUT IS AT HOME (`homeOf`): on its own face (a wing's valley
   pieces are its own hip-cut sheets' offcuts, and the face's own lead the
   series), or on the face across the HIP that cut it. A VALLEY makes no
   home: the sheet beyond a valley belongs to the slope it is on, and the
   face across the valley has its own hip-cut sheets — the Z's wing took
   the main's valley offcuts while its own F5–F8, the exact fit, sat in
   the pool. An offcut that fits nothing further along (a stub) is passed
   over. A SERIES IS ONE RUN OF SHEETS (2026-10-22, the owner on the Z:
   "the green D20 is out of place"): once C21 has fed a strip the next
   strip takes C20 — the sheet beside it in its block — whenever C20
   fits, before any bigger offcut from elsewhere. By size alone the east
   wing's own D20 (cut by the wing's hip, so at home on the end face)
   elbowed in between C21 and C20; it now waits for the strip the C run
   cannot fill, under the wing's own sheets, beside the wing it came off.
   What the series leaves open goes to the pool at large: every
   feasible pair scored — home first (600 for a hip end's claim, 300 for
   a pool-first valley piece's), then the fit's surplus, then 0.04 mm per
   mm of distance — and the best pair on the whole roof settled first
   (`matchPool`). THE PUSH (`pushPass`): a piece still open after that,
   whose run of neighbouring strips is fed by the series up to it, gets ONE
   full sheet ordered at the HEAD of that run — the apex of a hip end
   (`extra: 'push'` block, "pushed in"), or beside the last full strip at a
   junction, the owner's "7th B sheet next to B6" (the pool-first block's
   own sheet) — and every offcut between the head and the open piece moves
   one strip outward, onto a shorter piece, so the piece lands. A sheet
   ordered mid-series would leave the next piece just as short. A
   pool-first strip pushes BEFORE it falls back on its block (or the B
   sheet lands at the far end, not next to B6); a hip end's piece pushes
   only after the late pass below has had its go, because a bar end's
   0.31 m corner sliver is fed from a valley strip's offcut that is not a
   sheet until then — and a push for THAT would have cost the T two sheets
   an end. So a hip end's half nearest the FRONT slope is cut from the
   BACK slope's sheets, and vice versa — the crossing is what "never
   flipped" forces, and it is Auto-Block 2's "corresponding and matching
   off-cut triangle".
   A corner sliver under a third of a sheet wide and no longer than a sheet
   and a half (the EXPOSED length, not the lapped sheet's), or the triangle
   where a valley meets a hip (cut at both ends, under half a sheet wide and
   under a sheet long), is a SCRAP trimmed off the nearest offcut without
   consuming it, on a block face too — before that triangle took D8's whole
   offcut and B7 had to be ordered. A pool-first strip nothing fitted joins
   its block (unless it is under half the block's length — a wing's corner
   stub is ordered at its own length, never cut from a 7.73 m sheet) and
   its offcut joins the pool, and the needs still open get a second pass
   (a bar end's corner piece off the bar's own valley-cut sheet). What
   nothing fits after that is ordered as an extra at its OWN length.
   THE STRAIGHT CUT (2026-10-22, the owner on the 10 m wing: "Does E1
   actually have to be a full sheet or can it be the offcut to D1? And
   offcut D2 wouldn't work there because it going straight along the
   ridge a little, in real life the offcut to green D1 should be a
   straight cut, not have extra length to go along the ridge like that").
   The strip where a wing's ridge dies into the main's hip is bounded by
   the hip and then a short LEVEL run along that ridge, so its short side
   read longer than the hip alone would make it — 5.52 against 5.20 on
   the 10 m wing, 3.31 against 2.68 on the Big-L — and no plain-hip offcut
   was that shape, which is what forced a full sheet to be pushed in at
   the apex. A roofer cuts that sheet ONCE, along the hip, and the ridge
   capping covers the few hundred millimetres of the ridge run. So the
   builder gives such a piece `cutShortPx` — the diagonal continued across
   the whole width — where the level run is on a RIDGE (never a gutter or
   a barge: a sheet must reach those), and the fit and the offcut are
   worked from it; the piece still draws and measures at the roof's own
   shape. The push stays, for the roofs that still need it (a Z's east
   end, a T's bar end).
5. **Tally (Tally-Blocks).** Sheets to order per length, the blocks under
   it, how many end pieces the offcuts covered, how many full sheets were
   pushed in, how many sheets were ordered extra because no offcut fitted,
   and how many offcuts are left over.

On the shapes in the suite: the 18 × 12 m hip is 2 × 24 at 6.63 m, all 32
hip-end pieces from offcuts, two slivers over; the gable 2 × 24, nothing
cut; the dutch 64 (32 × 6.63 + 32 × 3.32 — see THE DUTCH GABLE below: each
gablet end ordered whole, its offcuts on the slopes' corners, none left
over); the
Big-L 64 — 48 × 7.73 and 16 × 3.32, the 16th the B sheet heading the top
run where a 3.52 extra stood before the straight-cut rule, nothing pushed;
the wing's end wholly out of the north slope's sheets (C1–C4 whole, the feet
of C5–C8); the west end's south half from C9 down to C1, its north half
D1–D6 (D6 on the junction strip, cut straight), its top from D7–D9; the east end from D16–D24 and
C24–C16; the wing's slope 8 with its valley from its own four hip offcuts;
six offcuts over — where the apex-laid wing cost 78 and the engine's legend
says 66; the 10 m wing 62 (48 × 7.73 + 14 × 5.52, was 63): D1's offcut at the
apex, D3 on the junction strip, a seventh B beside B6 and D4–D9 outward
from it, exactly as the owner marked it; the T 74 (75 until that evening's scrap rule below, 78 before 2026-10-22's offcut rules, 80
before that), its stem slopes' shortest valley strips off the bar's own
valley-cut sheets. The picture says all of this in its footer; a count the
engine's SHEETS TO ORDER legend gives is a different number worked a
different way, and the two are not reconciled — that is the owner's call.

**THE DUTCH GABLE** (2026-10-22, the owner: "do the dutch gable now, aswell
as a dutch gable T & L shape") is a hip end with its apex cut off: the
gablet's apron runs level across the top of the end face, a hip each side
of it down to the gutter. The builder laid that face as a RUN from one
corner (a level edge other than the gutter, two vertices at the top), so
every strip was a sheet of the end's own block and the slopes' corner
offcuts sat in the pool — 36 unused on the plain dutch. `isGablet` in
`_sheetPuzzleBuild` reads the top as a CHAIN of apron/barge edges (the
builder draws the apron in two halves meeting under the ridge's end) with
a hip kind either side reaching the gutter, and lays the face from the
chain's midpoint exactly as a hip end is laid from its apex (`lay =
'apex'`, `f.gablet`, `f.hipApexD` = where the two hips would meet). Each
half's k-th hip-cut strip from the centre is then the k-th corner sheet's
offcut from the slope opposite — which is how it shipped at 8:26 pm, and
the owner answered within the hour: "the short sheets at each dutch gable
ends should be cut at the hip and used on the other side of the hip on the
same end opposite corner". That was read as each side feeding its own
corner, and he put it right the same evening: "the number of those short
sheets (blue and purple looking at the plain rectangle) should be full
sheets the whole length of that gutter line, then the offcuts cut at the
hips should be used in the orange and green areas on the other side of the
hip". A GABLET IS ORDERED WHOLE AND FEEDS THE SLOPES. Every strip across a
gablet's gutter is one of its short sheets, the hip-cut ones included. A
slope's corner strip cut by a gablet's hip (`gabletHips`, `p.gabletFace`)
is pool-first: fed from that gablet's offcuts (`homeFor`), else its own
slope's, else one more of the gablet's short sheets when it is no longer
than they are (`fallbackOf`, after the late match), else the slope's own
sheet. A sheet is never flipped, so a gablet strip cut at one hip feeds the
slope corner at the gablet's OTHER hip — the north slope's west corner from
the west gablet's south half, the plain hip's pairing run the other way —
and nothing is carried to the far end of the house. THE CORNERS ARE LAID AS
COMPLEMENTS (2026-10-23, the owner: "all offcuts of the short sheets aren't
being used so it's not as efficient as it can be"). With the gablet laid from
its centre and the slope from the house corner, the slope's strip beside the
gablet's wall straddled it (a 6.62 m sheet ordered for a 3.3 m piece, two a
roof) and the gablet's corner offcuts were a fraction too narrow — 14 left
over on the plain dutch. Now each gablet half is laid from its CORNER in (a
full sheet at the corner, the narrow strip against the wall), and the
slope's corner from the WALL out (`f.walls`; a full sheet against the wall,
the narrow strip at the corner). The grids are complements across the hip:
a gablet strip at distance a' from the corner and a slope strip at a from it
pair when a + a' + width ≤ the gablet sheet's plan depth, which is the end's
depth rounded up — so the k-th gablet sheet's offcut is exactly the slope's
k-th piece from the wall, the narrow strip included. The run between two
walls starts at one and laps its closer on the other; a slope with one wall
laps at its plain hip corner as a run always has. `_pzDespike` drops the
zero-width spike a strip picks up when it is clipped exactly along a face's
own edge, and `seriesFeed` keeps each gablet corner its own series (the T's
bar has one under each gablet). The plain dutch is 64: 32 × 6.63 and 32 ×
3.32, not one offcut left over — 20 m less steel than the 68 before. THE
COOKIE CUTTER APPLIES TO A GABLET: on the
dutch L the wing's north gablet sits on the main's north slope's columns,
its strips under the apron are that slope's 7.73 m sheets slid up whole
(C1–C6, `viaTemplate`) and its hip-cut strips the feet of C7 and C8. Two
things had to give for that: a slid-up sheet whose piece happens to be a
FULL strip of the end face is still the rectangle's cut sheet (it counted
as a full strip of the template's block and made a block of five 1.66 m
shorts); and the 6 m left over such a sheet is a RECTANGLE with no hand
(`hand: 0`), which `fitScore` refused against every one-cut piece — it
serves either side now, and those rectangles feed the main's west hip
end's valley side (↺C9–↺C7, ↺C4, ↺C3–↺C1 up to the apex) where six extras
stood. The dutch L is 81 (82 before the corners were laid as complements): 40 × 7.73, 20 × 3.87 for the east gablet (ordered
whole, its offcuts on the main slopes' east corners), 20 × 3.32 and one
1.79 m valley stub; the west apex takes a pushed 7.73 now the east gablet's
offcuts stay at the east — 19 m less steel than the 79 before. AND THE DEPTH TEST MEASURES
THE HIP END, NOT THE GABLET FACE: the cookie cutter takes a hip end "at
least a sheet narrower than the slope", and a gablet face is shallower
than the end it is cut from by the gablet's height — so the dutch T's bar
ends (1.3 m run under the apron, 2.6 m to where their hips would meet)
read as a sheet narrower than the 3 m stem and were sliced from it: ten
3.32 m sheets slid across for 1.43 m strips with 1.89 m waste on each and
nowhere to use it. The test uses `f.hipApexD` and the bar keeps its centre
line like the hip T keeps its apex; the dutch T is 87 (27 × 3.32, 3.23,
35 × 2.87, 16 × 1.44 and 8 × 1.66 for its three gablets ordered whole, the
two junction strips the only extras; 90 before the corners were laid as
complements), no gablet's offcut left over. TWO FILL RULES WIDENED
WITH IT, and they are the one place a HIP shape moved: the push follows a
run fed from the pool at large as well as one the series fed (a valley
stub at the end of a pool-fed run was ordered as an extra at its own
length), and a two-cut triangle EXACTLY half a cover wide — a stem slope's
clipped last column, 0.82 m — is a scrap trimmed off any offcut, where a
`<` had kept it out by a hair and it was an extra sheet. That scrap frees
the offcut that had been feeding it, and on the hip T the bar's east end
then comes wholly off offcuts with nothing pushed: 74, not 75 (↺D15, ↺C7,
↺C8, ↺C9, ↺A22, ↺A21, ↺A20, ↺E14); the 13 m wing 72, not 73. Every other
hip shape is byte-identical before and after (dumped and diffed, not
assumed): a hip end has no level top edge, and `fitScore`'s rectangle rule
only ever sees a hand-0 offcut where one exists.

`_renderSheetPuzzleCanvas({thumb, roofIdxs, lines})` draws it in the calc
check's 960-wide frame (1× for the side card, 2× for the page and the PDF).
The Maps panel, the Sheet layout page type and the combined all-roofs
capture all render from it (`_jpCaptureSheetPlan`,
`_jpCaptureSheetPlanCombined` — every ticked roof in ONE frame now, since
they share the drawing's coordinates — and `_jpRenderSheetPlan`). The live
card passes `roofIdxs:[-1]` and the ORIGINAL lines, because the counting
pass borrows `DRAW.lines` while it works. `window._lastSheetPuzzle` is the
last build, for the suite. `tests/sheetlayout.mjs` (243) pins the rules face
by face on the plain hip, the gable, a change of pitch, the Big-L (the exact
label sequence of both hip ends, the cookie cutter's feet tiling with their
sheets), the T (its bar ends keep their apex), the dutch, the dutch L and
the dutch T (each gablet from its centre line, the L's wing gablet on the
north slope's columns, the T's bar ends never sliced from the stem) and the
owner's hand-counted fixtures: every face off a gutter, square to
gutter and ridge, 45° to hip and valley, no piece across a roof line, the
roof covered exactly once, every strip one cover wide but the last.

The first rebuild's block-cut code is gone from the tree; `fcaab9a` is the
commit that carried it, and the picture before that (the per-roof-type
cascade) is saved in `docs/legacy-sheet-layout-draw.js`, last live at
`b81e5c5`. `_ccColumnsFor` / `_ccNumberColumns` stay in sheet-plan.js
because the calc check tiles its columns through them.

### Two extras from one sheet (gable roofs only, 2026-10-23)

What nothing fits is ordered as an extra at its own length. On an L whose arms
differ in width, the pieces round the corner are hip- or valley-cut and longer
than any offcut on the roof, so each extra left a triangle that went in the
bin. Now an extra's sheet is lengthened 10 mm at a time until its offcut
(`offcutOf`) contains another open piece by `fitScore` — same hand, both sides,
width — and the longer sheet is kept only when the extra length is less than
the second piece would cost on its own. The first piece's diagonal is the
second's; the remainder is spun, never flipped. Skipped on any roof with a hip
end or a cookie-cutter end (`hipRoofX`, the swap pass's test).

### A valley tail is laid from its point, and the tails feed each other (gable roofs, 2026-10-23)

A face with no gutter that narrows to a single point at a valley, with a barge
across its wide end, is laid from the point (`f.tipLay`): shortest strip first,
only the strip at the barge part-width. Its strips then line up with the
valley-cut sheets' offcuts from the valley opposite. The whole roof is also laid
the old way (`opts.noTipLay`), and that is kept only if it orders fewer sheets.
On gable roofs the late step orders the pool-first strips longest first, one at
a time, with the pool re-matched after each, so a valley-cut sheet's offcut
exists before the shorter strip across the junction is given up as a sheet.

### The one-swap pass (gable roofs only, 2026-10-23)

THE GABLE + HIP & VALLEY T GIVES TWO SHEETS BACK (2026-10-23, the owner:
"The offcuts to blue B9, B10 and purple C9, C10, they're not being
utilized anywhere. They could be utilized in D14, D15, E15, E14"). Two
changes, both scoped. A top end within 50 mm of square on a strip at least
half a cover wide is cut SQUARE — the stem's top strip clipped 33 mm off
the little hip where its ridge starts, read as cut at both ends, and no
offcut could ever feed it. And a last pass (`swapPass`, end of
`_sheetPuzzleFill`): a pool-first strip that fell back on its block gives
its sheet back when a piece already fed can move onto an offcut lying
unused and hand its own offcut over (the bar's last strip ↺C10 onto D14's
offcut, so D15 takes C10's); slivers trimmed off the given-back sheet move
to the snuggest offcut left. A sheet is never flipped, so B's offcut lands
on the EAST stem slope and C's on the west. 74 → 72. GABLE ROOFS ONLY:
the pass skips any roof with a hip end or a cookie-cutter end, because on
the 24 × 12 L and the cross it saved a sheet each by moving pieces the
owner had already called perfect ("that ones perfect"). Every hip and
dutch picture is pixel-identical but the hip T's footer, whose "offcuts
left over" reads 10, not 12 — two 33 mm nicks no longer counted. B9's and
C9's offcuts (0.95 → 0.11 m) are still over: nothing left on that roof is
short enough for them.

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
