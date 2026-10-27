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

## Second cut, in hours, with the doubtful jobs left out (27 Oct, later)

The owner asked for plain hours rather than ratios, and for jobs with no real labour record to be
left out. Dropped from the 157 jobs that carry a roof area: 6 with no hours logged at all, 6 with
fewer than 0.12 man-hours per m² (a 250 m² roof with 17.5 hours logged — the timesheets are not on
the job: 2491, 2530, 2794, 2231, 2889, 2602) and 3 with more than 1.5 per m² (341 hours on 150 m² —
more than a re-roof: 2622, 2853, 2990). 142 jobs remain.

| Revenue band | Jobs | Calculator man-hours | Hours actually logged | Difference | Typical job: calc → actual | Logged h/m² | Typical m² |
|---|---|---|---|---|---|---|---|
| $0–5k | 11 | 226 | 205 | −21 h (−9 %) | 24 → 18 | 0.45 | 40 |
| $5k–14k | 27 | 834 | 824 | −10 h (−1 %) | 28 → 27 | 0.37 | 65 |
| $14k–25k | 62 | 3,682 | 4,808 | +1,126 h (+31 %) | 58 → 66 | 0.47 | 147 |
| $25k–45k | 30 | 2,726 | 4,688 | +1,962 h (+72 %) | 90 → 154 | 0.62 | 260 |
| $45k+ | 12 | 1,736 | 2,835 | +1,099 h (+63 %) | 121 → 225 | 0.57 | 334 |
| All | 142 | 9,204 | 13,360 | +4,156 h (+45 %) | 58 → 67 | 0.49 | 150 |

The office's own priced hours on the same 142 jobs: 12,133 against 13,360 logged (+10 %), the
$25k–45k band +32 %.

The four RoofMap-quoted jobs that survive the screen: 2917 (68 calc → 75.5 logged), 3206 (48 → 48.5),
3099 (44 → 64.8), 3270 (86 → 139.8): 246 → 329, +34 %.

### Every job with an area (hours are crew man-hours)

Roof m², flashing lm and dektites are read off the quote in Fergus. On a RoofMap quote the flashing
figure is barge + apron + change of pitch + ridge + hip and the cuts are ridge + hip + valley; on an
office-written quote there is one flashing total ("FLA …") and the cuts are assumed to be half of it,
so a "≈" calculator figure is approximate. "Left out" marks the jobs dropped above.

| Job | Done | Place | Revenue | Roof m² | Flashing lm | Dektites | Calc man-h | Priced h | Actual h | Actual − calc |
|---|---|---|---|---|---|---|---|---|---|---|
| 2673 | 2026-02-04 | Kohukohu | $21,611 | 145 | 80.0 | 1 | 58≈ | 68.0 | 67.5 | +10 |
| 2545 | 2026-02-04 | Waipapa | $13,700 | 150 | 40.0 | 1 | 52≈ | 56.0 | 24.3 | -28 |
| 2618 | 2026-02-04 | Kohukohu | $23,426 | 130 | 100.0 | 1 | 60≈ | 120.0 | 167.5 | +108 |
| 2365 | 2026-02-04 | Kawakawa | $20,718 | 210 | 103.0 | 0 | 108≈ | 90.0 | 169.3 | +61 |
| 2628 | 2026-02-04 | Kawakawa | $23,029 | 210 | 59.0 | 1 | 66≈ | 78.0 | 62.5 | -4 |
| 2559 | 2026-02-04 | Ōkaihau | $10,214 | 130 | 40.0 | 1 | 50≈ | 24.0 | 24.8 | -25 |
| 2552 | 2026-02-04 | Moerewa | $15,375 | 150 | 60.0 | 1 | 68≈ | 64.0 | 83.5 | +16 |
| 2610 | 2026-02-04 | Awarua | $5,587 | 100 | 17.0 | 0 | 30≈ | 30.0 | 32.5 | +2 |
| 2544 | 2026-02-04 | Pakaraka | $8,479 | 35 | 25.0 | 0 | 16≈ | 32.0 | 30.8 | +15 |
| 2578 | 2026-02-04 | Waipapa | $30,206 | 185 | 110.0 | 1 | 110≈ | 140.0 | 174.5 | +64 |
| 2574 | 2026-02-04 | Oromahoe | $15,450 | 100 | 32.0 | 0 | 40≈ | 40.0 | 37.5 | -2 |
| 2564 | 2026-02-04 | Kaikohe | $17,978 | 160 | 50.0 | 1 | 52≈ | 70.0 | 100.0 | +48 |
| 2469 | 2026-02-04 | Kerikeri | $25,427 | 440 | 0.0 | 1 | 100≈ | 100.0 | 150.0 | +50 |
| 2528 | 2026-02-04 | Kawakawa | $18,075 | 185 | 65.0 | 1 | 76≈ | 64.0 | 71.5 | -4 |
| 2459 | 2026-02-04 | Kerikeri | $8,912 | 75 | 26.0 | 0 | 30≈ | 30.0 | 12.5 | -18 |
| 2442 | 2026-02-04 | Ōkaihau | $21,230 | 192 | 60.0 | 0 | 62≈ | 90.0 | 110.0 | +48 |
| 2506 | 2026-02-04 | Kaikohe | $15,910 | 120 | 50.0 | 1 | 44≈ | 60.0 | 51.3 | +7 |
| 2491 | 2026-02-04 | Kerikeri | $6,716 | 250 | 30.0 | 0 | 66≈ | 22.0 | 17.5 | -48 (left out) |
| 2497 | 2026-02-04 | Ōkaihau | $4,300 | 30 | 25.0 | 0 | 24≈ | 12.0 | 24.0 | +0 |
| 2438 | 2026-02-04 | Kerikeri | $20,064 | 220 | 51.0 | 0 | 70≈ | 84.0 | 74.8 | +5 |
| 2489 | 2026-02-04 | Kerikeri | $10,884 | 180 | 25.0 | 1 | 50≈ | 40.0 | 24.0 | -26 |
| 2432 | 2026-02-04 | Kaikohe | $26,512 | 270 | 51.0 | 0 | 84≈ | 128.0 | 125.3 | +41 |
| 2439 | 2026-02-04 | Waipapa | $16,942 | 155 | 51.0 | 0 | 62≈ | 80.0 | 118.8 | +57 |
| 2451 | 2026-02-04 | Kaikohe | $17,769 | 120 | 51.0 | 0 | 56≈ | 90.0 | 150.0 | +94 |
| 2398 | 2026-02-04 | Paihia | $48,580 | 367 | 85.0 | 0 | 116≈ | 261.0 | 213.8 | +98 |
| 2440 | 2026-02-04 | Awarua | $11,160 | 80 | 35.0 | 0 | 38≈ | 44.0 | 24.8 | -13 |
| 2420 | 2026-02-04 | Kerikeri | $5,093 | 61 | 0.0 | 0 | 36≈ | 20.0 | 27.0 | -9 |
| 2258 | 2026-02-04 | Motatau | $44,687 | 215 | 80.0 | 0 | 92≈ | 164.0 | 280.8 | +189 |
| 2412 | 2026-02-04 | Kaikohe | $16,002 | 100 | 80.0 | 0 | 74≈ | 88.0 | 63.8 | -10 |
| 2378 | 2026-02-04 | Northland | $18,747 | 127 | 55.0 | 0 | 60≈ | 72.0 | 59.8 | -0 |
| 2376 | 2026-02-04 | paihia | $20,538 | 127 | 40.0 | 0 | 48≈ | 72.0 | 51.0 | +3 |
| 2386 | 2026-02-04 | Paihia | $17,212 | 122 | 51.0 | 0 | 56≈ | 80.0 | 61.5 | +6 |
| 2362 | 2026-02-04 | Kerikeri | $15,585 | 100 | 51.0 | 0 | 54≈ | 65.0 | 68.3 | +14 |
| 2356 | 2026-02-04 | Kerikeri | $17,739 | 130 | 0.0 | 0 | 32≈ | 50.0 | 55.0 | +23 |
| 2345 | 2026-02-04 | Moerewa | $18,990 | 150 | 0.0 | 0 | 34≈ | 70.0 | 100.8 | +67 |
| 2336 | 2026-02-04 | Ōtaua | $18,261 | 175 | 80.0 | 1 | 86≈ | 90.0 | 78.3 | -8 |
| 2354 | 2026-02-04 | Kaikohe | $11,214 | 60 | 0.0 | 0 | 14≈ | 60.0 | 49.3 | +35 |
| 2338 | 2026-02-04 | Kaikohe | $94,105 | 570 | 225.0 | 0 | 250≈ | 376.0 | 190.0 | -60 |
| 2665 | 2026-02-06 | Awarua | $15,259 | 150 | 43.0 | 1 | 48≈ | 60.0 | 34.3 | -14 |
| 2598 | 2026-02-06 | Kawakawa | $16,946 | 135 | 60.0 | 1 | 50≈ | 60.0 | 65.0 | +15 |
| 2530 | 2026-02-18 | Ōkaihau | $16,092 | 256 | 80.0 | 1 | 98≈ | 40.0 | 22.0 | -76 (left out) |
| 2732 | 2026-02-19 | Kaikohe | $16,239 | 170 | 50.0 | 1 | 62≈ | 70.0 | 61.8 | -0 |
| 2721 | 2026-03-04 | Moerewa | $17,772 | 135 | 55.0 | 1 | 48≈ | 80.0 | 53.5 | +6 |
| 2793 | 2026-04-10 | Ōkaihau | $5,182 | 40 | 80.0 | 0 | 34≈ | 10.0 | 8.0 | -26 |
| 2631 | 2026-04-22 | Kaikohe | $11,048 | 253 | 0.0 | 0 | 58≈ | 90.0 | 60.5 | +2 |
| 2702 | 2026-05-06 | Kerikeri | $20,577 | 170 | 60.0 | 1 | 62≈ | 84.0 | 104.0 | +42 |
| 2471 | 2026-05-06 | Russell | $20,811 | 150 | 70.0 | 1 | 60≈ | 90.0 | 165.3 | +105 |
| 2596 | 2026-05-06 | Kaikohe | $31,905 | 195 | 85.0 | 1 | 84≈ | 140.0 | 126.3 | +42 |
| 2540 | 2026-05-06 | Kaikohe | $22,938 | 200 | 65.0 | 1 | 74≈ | 80.0 | 67.5 | -6 |
| 2313 | 2026-05-06 | Kaikohe | $28,000 | 290 | 105.0 | 1 | 98≈ | 80.0 | 69.5 | -28 |
| 2861 | 2026-05-13 | Kawakawa | $31,024 | 310 | 127.0 | 1 | 110≈ | 130.0 | 112.5 | +2 |
| 2369 | 2026-05-20 | Kaikohe | $29,120 | 200 | 127.0 | 0 | 124≈ | 132.0 | 139.8 | +16 |
| 2826 | 2026-05-20 | Ōhaeawai | $15,736 | 140 | 46.0 | 1 | 46≈ | 70.0 | 40.0 | -6 |
| 2705 | 2026-05-28 | Kaikohe | $19,471 | 205 | 80.0 | 1 | 72≈ | 70.0 | 56.0 | -16 |
| 2852 | 2026-06-02 | Ōtaua | $15,205 | 145 | 65.0 | 1 | 70≈ | 70.0 | 56.0 | -14 |
| 2595 | 2026-06-11 | Kerikeri | $30,592 | 290 | 55.0 | 1 | 82≈ | 100.0 | 166.3 | +84 |
| 2794 | 2026-06-11 | Kerikeri | $10,294 | 290 | 37.0 | 0 | 76≈ | 40.0 | 16.0 | -60 (left out) |
| 2422 | 2026-06-11 | Kaikohe | $32,844 | 260 | 75.0 | 0 | 94≈ | 152.0 | 194.0 | +100 |
| 2808 | 2026-06-11 | Kaikohe | $14,290 | 175 | 60.0 | 1 | 58≈ | 60.0 | 65.5 | +8 |
| 2525 | 2026-06-11 | Waipapa | $17,405 | 186 | 0.0 | 0 | 42≈ | 22.0 | 31.3 | -11 |
| 2872 | 2026-06-11 | Matauri Bay | $19,618 | 140 | 50.0 | 1 | 52≈ | 70.0 | 50.5 | -2 |
| 2371 | 2026-06-11 | Kaeo | $28,975 | 335 | 60.0 | 0 | 94≈ | 88.0 | 229.0 | +135 |
| 2671 | 2026-06-11 | Kaeo | $2,324 | 120 | 0.0 | 0 | 28≈ | 12.0 | 15.5 | -12 |
| 2638 | 2026-06-11 | Haruru | $3,022 | 20 | 0.0 | 0 | 6≈ | 14.0 | 9.8 | +4 |
| 2716 | 2026-06-11 | Ōkaihau | $4,485 | 65 | 18.0 | 0 | 24≈ | 16.0 | 26.5 | +2 |
| 2625 | 2026-06-17 | Te Kamo | $37,421 | 330 | 80.0 | 1 | 100≈ | 140.0 | 202.8 | +103 |
| 2750 | 2026-06-17 | Pakaraka | $2,964 | 100 | 4.0 | 1 | 24≈ | 14.0 | 12.0 | -12 |
| 2504 | 2026-06-17 | Kaikohe | $7,127 | 80 | 45.0 | 1 | 46≈ | 16.0 | 35.3 | -11 |
| 2577 | 2026-06-17 | Kaikohe | $27,959 | 141 | 105.0 | 1 | 88≈ | 112.0 | 148.3 | +60 |
| 2622 | 2026-06-17 | Ōkaihau | $76,000 | 150 | 130.0 | 1 | 74≈ | 200.0 | 341.3 | +267 (left out) |
| 2915 | 2026-06-21 | Rawene | $18,646 | 140 | 80.0 | 1 | 56≈ | 50.0 | 65.5 | +10 |
| 2814 | 2026-06-23 | Russell | $36,802 | 200 | 85.0 | 1 | 82≈ | 110.0 | 125.3 | +43 |
| 2848 | 2026-06-24 | Kerikeri | $37,394 | 350 | 110.0 | 1 | 112≈ | 120.0 | 193.5 | +82 |
| 2815 | 2026-07-02 | Kaeo | $24,679 | 220 | 80.0 | 1 | 74≈ | 110.0 | 107.8 | +34 |
| 2786 | 2026-07-02 | Bay of Islands | $6,792 | 40 | 35.0 | 0 | 20≈ | 24.0 | 59.5 | +40 |
| 2727 | 2026-07-02 | Whirinaki | $20,045 | 140 | 70.0 | 1 | 54≈ | 70.0 | 72.0 | +18 |
| 2691 | 2026-07-02 | Taheke | $23,669 | 205 | 50.0 | 1 | 72≈ | 80.0 | 79.8 | +8 |
| 2712 | 2026-07-02 | Moerewa | $5,113 | 20 | 35.0 | 0 | 22≈ | 28.0 | 6.5 | -16 |
| 2693 | 2026-07-02 | Kerikeri | $15,847 | 120 | 50.0 | 1 | 44≈ | 40.0 | 81.5 | +38 |
| 2690 | 2026-07-02 | Kaikohe | $24,081 | 215 | 55.0 | 1 | 72≈ | 90.0 | 56.5 | -16 |
| 2960 | 2026-07-02 | Kaikohe | $31,161 | 280 | 80.0 | 1 | 88≈ | 120.0 | 157.0 | +69 |
| 2735 | 2026-07-03 | Kaikohe | $27,093 | 164 | 80.0 | 1 | 70≈ | 110.0 | 92.8 | +23 |
| 2845 | 2026-07-03 | Kaikohe | $8,367 | 80 | 35.0 | 0 | 28≈ | 28.0 | 32.0 | +4 |
| 2778 | 2026-07-08 | Ōkaihau | $8,346 | 20 | 14.0 | 0 | 10≈ | 10.0 | 15.8 | +6 |
| 2782 | 2026-07-08 | Russell | $90,440 | 600 | 270.0 | 5 | 218≈ | 450.0 | 293.5 | +76 |
| 2762 | 2026-07-08 | Opononi | $20,773 | 145 | 85.0 | 1 | 60≈ | 70.0 | 92.0 | +32 |
| 2706 | 2026-07-16 | Paihia | $42,664 | 270 | 130.0 | 0 | 122≈ | 140.0 | 199.3 | +77 |
| 2965 | 2026-07-16 | Kaeo | $7,144 | 75 | 25.0 | 1 | 26≈ | 24.0 | 24.0 | -2 |
| 2769 | 2026-07-16 | Ōkaihau | $29,545 | 170 | 108.0 | 1 | 84≈ | 124.0 | 196.3 | +112 |
| 2679 | 2026-07-16 | Kaikohe | $47,666 | 290 | 165.0 | 2 | 116≈ | 144.0 | 234.5 | +118 |
| 2900 | 2026-07-20 | Kerikeri | $19,468 | 190 | 55.0 | 1 | 60≈ | 70.0 | 41.8 | -18 |
| 2557 | 2026-07-20 | Motatau | $19,959 | 170 | 60.0 | 1 | 58≈ | 90.0 | 178.3 | +120 |
| 2583 | 2026-07-20 | Waikare | $53,370 | 500 | 130.0 | 1 | 152≈ | 240.0 | 215.0 | +63 |
| 2570 | 2026-07-20 | Ōkaihau | $24,946 | 145 | 80.0 | 1 | 58≈ | 84.0 | 161.5 | +104 |
| 2993 | 2026-07-21 | Kaeo | $3,252 | 16 | 40.0 | 2 | 18≈ | 14.0 | 17.0 | -1 |
| 2817 | 2026-07-21 | Puketona | $29,293 | 210 | 80.0 | 1 | 72≈ | 130.0 | 215.0 | +143 |
| 2704 | 2026-07-22 | Kaikohe | $30,516 | 280 | 98.0 | 3 | 92≈ | 140.0 | 212.8 | +121 |
| 2876 | 2026-07-28 | Matawaia | $13,296 | 140 | 55.0 | 1 | 50≈ | 50.0 | 36.0 | -14 |
| 2927 | 2026-07-31 | Kaikohe | $16,675 | 130 | 45.0 | 1 | 44≈ | 70.0 | 84.8 | +41 |
| 2479 | 2026-07-31 | Kaikohe | $17,376 | 150 | 50.0 | 1 | 50≈ | 70.0 | 72.3 | +22 |
| 2999 | 2026-08-04 | Kawakawa | $28,736 | 328 | 85.0 | 1 | 102≈ | 70.0 | 56.5 | -46 |
| 2964 | 2026-08-05 | Kaikohe | $7,054 | 50 | 18.0 | 0 | 18≈ | 30.0 | 16.8 | -1 |
| 3063 | 2026-08-05 | Awanui | $5,662 | 30 | 16.0 | 1 | 12≈ | 24.0 | 33.0 | +21 |
| 3016 | 2026-08-05 | Kerikeri | $27,569 | 260 | 100.0 | 3 | 90≈ | 120.0 | 87.0 | -3 |
| 2231 | 2026-08-05 | Kaikohe | $16,504 | 158 | 43.4 | 2 | 46 | 62.0 | 17.5 | -28 (left out) |
| 2865 | 2026-08-10 | Moerewa | $20,356 | 140 | 70.0 | 1 | 54≈ | 70.0 | 26.8 | -27 |
| 2973 | 2026-08-13 | Ōhaeawai | $2,347 | 17 | 0.0 | 3 | 6≈ | 12.0 | 16.0 | +10 |
| 3004 | 2026-08-13 | Kerikeri | $17,454 | 100 | 90.0 | 2 | 52≈ | 80.0 | 62.5 | +10 |
| 2542 | 2026-08-20 | Russell | $27,711 | 145 | 100.0 | 1 | 64≈ | 90.0 | 170.5 | +106 |
| 2875 | 2026-08-20 | Punakitere Val | $21,817 | 230 | 85.0 | 1 | 78≈ | 80.0 | 121.0 | +43 |
| 2853 | 2026-08-20 | Kerikeri | $56,219 | 180 | 150.0 | 0 | 94≈ | 240.0 | 279.3 | +185 (left out) |
| 2835 | 2026-08-20 | Kaikohe | $81,341 | 1180 | 80.0 | 1 | 230≈ | 330.0 | 328.0 | +98 |
| 2776 | 2026-08-20 | Okiato | $28,102 | 190 | 70.0 | 1 | 72≈ | 114.0 | 115.0 | +43 |
| 2972 | 2026-08-20 | Ōkaihau | $9,037 | 65 | 36.0 | 2 | 26≈ | 40.0 | 24.3 | -2 |
| 2942 | 2026-08-20 | Kaeo | $16,199 | 140 | 55.0 | 1 | 50≈ | 60.0 | 55.5 | +6 |
| 2840 | 2026-08-20 | Russell | $1,915 | 140 | 0.0 | 0 | 32≈ | 20.0 | 20.5 | -12 |
| 3002 | 2026-08-21 | Kaeo | $25,300 | 125 | 45.0 | 2 | 54≈ | 90.0 | 98.3 | +44 |
| 2990 | 2026-08-24 | Waimamaku | $11,798 | 50 | 22.0 | 1 | 20≈ | 45.0 | 88.3 | +68 (left out) |
| 3090 | 2026-08-27 | Kaikohe | $4,656 | 40 | 30.0 | 0 | 28≈ | 20.0 | 18.0 | -10 |
| 3012 | 2026-09-01 | Moerewa | $18,502 | 100 | 28.0 | 3 | 32≈ | 60.0 | 52.5 | +20 |
| 2224 | 2026-09-01 | Kaeo | $45,433 | 150 | 110.0 | 1 | 68≈ | 160.0 | 204.3 | +136 |
| 2535 | 2026-09-02 | Taheke | $40,573 | 250 | 105.0 | 1 | 90≈ | 142.0 | 216.3 | +126 |
| 3023 | 2026-09-02 | Paihia | $46,560 | 290 | 110.0 | 2 | 96≈ | 120.0 | 105.5 | +10 |
| 2889 | 2026-09-02 | Paihia | $31,317 | 140 | 52.0 | 1 | 48≈ | 100.0 | 15.0 | -33 (left out) |
| 3125 | 2026-09-09 | 98 settlers wa | $10,070 | 70 | 45.0 | 1 | 44≈ | 30.0 | 37.8 | -6 |
| 2917 | 2026-09-09 | Oue | $24,739 | 152 | 42.7 | 0 | 68 | 90.0 | 75.5 | +8 |
| 3131 | 2026-09-17 | Russell | $6,564 | 35 | 44.0 | 0 | 22≈ | 16.0 | 48.8 | +27 |
| 3200 | 2026-09-20 | Kerikeri | $6,884 | 30 | 30.0 | 0 | 16≈ | 40.0 | 15.0 | -1 |
| 2994 | 2026-09-22 | Ōkaihau | $16,600 | 150 | 40.0 | 0 | 52≈ | 80.0 | 47.5 | -4 |
| 2344 | 2026-09-22 | KERIKERI | $79,155 | 483 | 170.0 | 0 | 196≈ | 200.0 | 297.5 | +102 |
| 2602 | 2026-09-22 | Kaikohe | $19,216 | 130 | 43.0 | 1 | 54≈ | 80.0 | 3.8 | -50 (left out) |
| 3119 | 2026-09-23 | Parekura Bay | $11,042 | 60 | 40.0 | 0 | 26≈ | 52.0 | 56.8 | +31 |
| 3206 | 2026-09-23 | Taheke | $14,784 | 149 | 44.3 | 1 | 48 | 52.0 | 48.5 | +0 |
| 3164 | 2026-09-30 | Matauri Bay | $16,663 | 70 | 35.0 | 1 | 30≈ | 72.0 | 40.5 | +10 |
| 2614 | 2026-10-01 | Kaeo | $23,513 | 120 | 72.0 | 1 | 72≈ | 90.0 | 85.8 | +14 |
| 3099 | 2026-10-01 | Kerikeri | $17,086 | 78 | 30.8 | 0 | 44 | 60.0 | 64.8 | +21 |
| 2967 | 2026-10-07 | Waimate North | $22,924 | 520 | 80.0 | 0 | 142≈ | 100.0 | 66.0 | -76 |
| 3244 | 2026-10-07 | Northland | $2,971 | 40 | 8.5 | 0 | 12≈ | 12.0 | 18.0 | +6 |
| 2725 | 2026-10-08 | Kohukohu | $64,847 | 300 | 170.0 | 1 | 126≈ | 330.0 | 418.3 | +292 |
| 3202 | 2026-10-11 | Karetu | $6,405 | 55 | 32.0 | 0 | 22≈ | 24.0 | 44.3 | +22 |
| 3270 | 2026-10-12 | Ōkaihau | $20,195 | 270 | 45.3 | 0 | 86 | 72.0 | 139.8 | +54 |
| 3073 | 2026-10-12 | Pakaraka | $33,833 | 260 | 80.0 | 2 | 84≈ | 80.0 | 138.3 | +54 |
| 3215 | 2026-10-19 | russell | $3,690 | 28 | 20.0 | 0 | 24≈ | 14.0 | 28.0 | +4 |
| 3276 | 2026-10-19 | Kaeo | $15,409 | 130 | 50.0 | 1 | 58≈ | 40.0 | 49.5 | -8 |
| 3274 | 2026-10-19 | Matauri Bay | $14,393 | 105 | 35.0 | 1 | 36≈ | 40.0 | 36.0 | +0 |
| 2997 | 2026-10-19 | Raumanga | $35,716 | 315 | 100.0 | 0 | 102≈ | 108.0 | 158.3 | +56 |
| 3113 | 2026-10-19 | Ōkaihau | $33,936 | 280 | 60.0 | 1 | 86≈ | 135.0 | 137.0 | +51 |
| 3218 | 2026-10-20 | Kaeo | $20,701 | 190 | 80.0 | 1 | 68≈ | 80.0 | 88.3 | +20 |
| 3176 | 2026-10-20 | Haruru | $13,051 | 70 | 70.0 | 0 | 38≈ | 50.0 | 20.0 | -18 |
| 2919 | 2026-10-21 | russell | $74,278 | 285 | 130.0 | 1 | 104≈ | 280.0 | 255.3 | +151 |
| 3117 | 2026-10-26 | Morningside | $46,905 | 140 | 100.0 | 4 | 64≈ | 120.0 | 79.0 | +15 |
