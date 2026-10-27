# RoofMap's labour calculator against the back-costed jobs — 27 Oct 2026

Run by the **Hub labour calculator check** workflow (`.github/workflows/hub-labour-check.yml`,
`floodroofing/hub-api/scripts/labour-check.js`): Actions → "Hub labour calculator check" → Run
workflow. It reads Fergus and Xero through the fergus-proxy, prints the per-job table to the run's
log and uploads `labour-check.csv`. Run 4 (`30185947`) is the one these figures come from:
https://github.com/office4777/flood-roofing-estimator/actions/runs/40461928441

## What the calculator does (app.html, `_labourCalcHours`)

Crew hours = roof m² ÷ 14 + sheet columns ÷ 6 + cut lm (ridge + hip + valley) ÷ 18 + flashing lm
(barge + apron + change of pitch + ridge + hip) ÷ 8 + penetrations ÷ 6, rounded UP, and both the
lead and the apprentice get that figure — so the man-hours it prices are 2 × that. Columns = gutter
run ÷ 0.762. No driver for travel, strip-off, scaffold erection or repairs.

## Coverage

| | |
|---|---|
| Completed jobs in Fergus | 416 (38 pole sheds left out) |
| Back-costed non-shed jobs checked | 386 (382 completed + 4 active and 80 %+ invoiced) |
| With priced AND logged hours | 237 |
| With RoofMap's own itemised quote (m², flashings, pipes) | 6, 5 with logged hours — the EXACT test |
| With m² + one flashing figure on an office-written Fergus quote | 147 — the APPROXIMATE test |

Only six finished jobs were quoted through RoofMap with itemised lines (the itemised push is
recent; older pushes went to Fergus as "Labour / Materials / Scaffolding" lumps). The rest were
quoted in Fergus by hand on the office template ("40m 0.40g MAXAM /m2 of job", "FLA Colorsteel
flashings (barges, ridges …)", "LL Labour Lead", "LA Labour Apprentice", "Dektites"), which gives the
roof area and a flashing total but not the cut / flashing split, so for those the check assumes the
cuts are half the flashing figure and takes the pipes from the dektite line. Actual hours are the
man-hours logged in Fergus against the job — travel, scaffold and re-visits included.

## Exact test — the five RoofMap-quoted jobs

| Job | m² | Calc man-h | Priced | Actual | Act ÷ Calc |
|---|---|---|---|---|---|
| 2917 Oue | 151.5 | 68 | 90 | 75.5 | 1.11 |
| 3206 Taheke | 149.0 | 48 | 52 | 48.5 | 1.01 |
| 3099 Kerikeri | 78.5 | 44 | 60 | 64.8 | 1.47 |
| 3270 Ōkaihau | 270.0 | 86 | 72 | 139.8 | 1.63 |
| 2231 Kaikohe | 158.0 | 46 | 62 | 17.5 | 0.38 (only 17.5 h logged on a 158 m² roof — incomplete) |

Sum 292 calculated against 346 logged (1.18); median 1.11. On four of the five the office typed
over the calculated hours.

## Approximate test — 147 office-quoted jobs

| Revenue band | Jobs | Σ calc h | Σ actual h | Act ÷ Calc | Median | Within ±20 % | Over by 20 %+ | Actual h/m² |
|---|---|---|---|---|---|---|---|---|
| $0 – 5k | 11 | 226 | 205 | 0.91 | 1.00 | 36 % | 27 % | 0.33 |
| $5k – 14k | 31 | 1,100 | 1,133 | 1.03 | 0.93 | 26 % | 32 % | 0.37 |
| $14k – 25k | 60 | 3,588 | 4,504 | 1.26 | 1.15 | 42 % | 43 % | 0.47 |
| $25k – 45k | 31 | 2,774 | 4,703 | 1.70 | 1.63 | 10 % | 81 % | 0.61 |
| $45k + | 14 | 1,904 | 3,455 | 1.81 | 1.68 | 7 % | 86 % | 0.63 |
| ALL | 147 | 9,592 | 14,000 | 1.46 | 1.23 | 28 % | 52 % | 0.53 |

The office's own priced hours (237 jobs) sit at 1.11 overall (median 1.03), but 1.29 in the
$25k – 45k band (median 1.31, 58 % of those jobs ran 20 %+ over).

Man-hours per m² actually logged, every job with an area (152): median 0.49, quartiles 0.34 – 0.73.
By band: 0.45 / 0.37 / 0.47 / 0.61 / 0.60. The calculator's roof driver alone is 0.14 h/m²
(2 ÷ 14); with cuts, flashings and columns a typical re-roof comes out near 0.30 – 0.35 h/m².

A least-squares fit of the logged hours on the drivers (147 jobs) hardly moves the roof rate
(14 → 14.6) or the columns (6 → 6.6), pulls flashings from 8 to 5.6 lm/crew-hour and pushes the
penetration rate to nothing — and still explains the jobs no better (mean error 58 % → 65 %). The
big-job gap is not a rate problem; it is time the calculator has no driver for.

## Reading

1. Under about $14k the calculator is right on average (0.9 – 1.0) — leave the rates.
2. From $14k up it reads low, and from $25k up it reads about 40 % low (crews take 1.6 – 1.8 ×).
   The hours it misses are the ones the office template already prices separately and the
   calculator does not: travel ("travel cost per hour", 2.9 h on a typical office quote), the
   crew's own scaffold erection (see below), strip-off and disposal, repairs and re-visits on bigger
   roofs. Adding those as drivers (travel hours a day × days, scaffold lm when the crew erects it,
   strip-off m²) is the fix; a flat ×1.6 on big jobs would hide why.
3. The plainest check figure: budget 0.5 man-hours per m² on a re-roof, 0.35 on a small job, 0.6
   on a big one.
4. Re-run this in three to six months: once more RoofMap-quoted jobs are finished the EXACT test
   will have enough jobs to fit the rates properly (it needs 8+).

## Scaffold — bought in or own crew?

Fergus's API exposes no supplier invoices (ten endpoint shapes tried, all 404), so the check read
Xero's supplier bills instead: 4,801 bills (about the last 14 months), 89 from scaffold companies
(Bay of Islands Scaffolding, Northland Scaffolding, Next Level Scaffolding, Edge Guard Scaffolding),
41 of them tied to a job by a job number or the street in the reference.

- 40 back-costed jobs priced scaffolding. 18 have a scaffold bill → bought in: $68,971 invoiced
  against $83,300 charged (median 78 % of the charge; four jobs paid MORE for the scaffold than they
  charged). 22 have no bill → own crew, or a bill with no job reference.
- 11 jobs have a scaffold bill but no scaffold line on the quote: 2578, 2335, 2705, 2690, 2768, 2865,
  3214, 3012, 2809, 3215, 2997.
- 48 scaffold bills ($139,774) carry no job number or address in the Xero reference and cannot be
  tied to a job from outside Fergus. Put the job number in the reference (or cost the bill to the
  job in Fergus) and the next run will place them.
- Jobs 3214 / 3215 / 2919 (one Russell site split into three jobs) share three bills; run 4 counted
  them on each job, run 5 onwards shares a multi-job bill by revenue.
- Jobs finished before about August 2025 are outside the bills read; "no scaffold bill found" on
  those means nothing.

Full per-job detail: the run's log and the `labour-check.csv` artifact (job number, m², columns,
cuts, flashings, pipes, calculated / priced / actual hours, scaffold priced and invoiced).
