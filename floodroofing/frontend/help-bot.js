/* ============================================================================
   RoofMap Help Assistant — self-contained in-app chatbot.
   A floating launcher + chat panel with a curated knowledge base and a
   fuzzy keyword matcher. No network / LLM needed — every answer is local,
   so it works offline and never exposes customer data.

   The knowledge base (FRQA) holds ~160 topics; each carries several example
   phrasings, so the matcher recognises well over a thousand distinct
   questions and maps them to the right answer.
   Office-app only — it never renders on the shared customer proposal.
   ========================================================================== */
(function () {
  'use strict';

  // ── Knowledge base ────────────────────────────────────────────────────
  // { q:[trigger phrasings], a:'answer', c:'category' }.  Answers support a
  // tiny markup: lines beginning "- " become bullets and **x** is bold.
  var FRQA = [
    // ---- Getting started / general ----
    { c:'Start', q:['what is roofmap','what is this app','what does this program do','what is this tool','how does roofmap work','explain the app','what can i do here'],
      a:"**RoofMap** is Flood Roofing's estimator. It takes you from an aerial photo of a roof to a measured plan, a materials/Job Pack, a professional customer quote, and a supplier order — all in one place.\n\nThe workflow follows the tabs left to right:\n- **Home** — pick or start a job\n- **Map Roof** — trace and measure the roof\n- **Job Pack** — materials, cut lists, flashings\n- **Quote** — build and send the customer proposal\n- **Jobs** — every saved job\n- **Settings** — company details, suppliers, pricing" },
    { c:'Start', q:['how do i start','where do i begin','how do i get started','first steps','how to begin a new estimate','getting started'],
      a:"Start on the **Home** tab:\n- Tap **New job**, enter the client name + address, and press Start.\n- You'll land on **Map Roof** — upload the aerial photo and trace the roof.\n- Move through **Job Pack** then **Quote** using the blue *Next* button at the bottom of each tab." },
    { c:'Start', q:['what order do i do things','workflow','what are the steps','process','steps to make a quote','full process'],
      a:"The normal flow is:\n1. **Home** → New job (client + address)\n2. **Map Roof** → trace the outline, add ridge/hip/valley lines, set the pitch\n3. **Job Pack** → check profile, grade, colour, gutter, flashings and cut lists\n4. **Quote** → review pricing, then **Customer link** or **Email quote**\n5. When accepted → **Order Roof** to the supplier and **Push to Fergus**" },
    { c:'Start', q:['is my work saved','does it save automatically','autosave','will i lose my work','does it save'],
      a:"Yes — jobs **autosave** as you work, and you can press **Save** any time. Everything lives under the **Jobs** tab and in *Recent drafts* on Home. Because it saves to this browser, use the same device/login to pick a draft back up." },

    // ---- Home / jobs / drafts ----
    { c:'Jobs', q:['how do i make a new job','create a job','start a new job','add a job','new job','new estimate','new quote job'],
      a:"On the **Home** tab tap **New job**. A popup asks for the client name, site address, email and phone. Fill those in and press Start — it creates the job and opens **Map Roof**." },
    { c:'Jobs', q:['where are my saved jobs','find a job','see all jobs','list of jobs','open an old job','past jobs','job history'],
      a:"Open the **Jobs** tab for every saved job, or use **Recent drafts** on the Home tab for the latest ones. Tap any row to load it. There's a search box to filter by client or address." },
    { c:'Jobs', q:['recent drafts','what are drafts','draft jobs','unfinished jobs'],
      a:"**Recent drafts** on the Home tab lists your most recent unfinished jobs (5 at a time — scroll for more). Tap one to keep working, or use the delete button on a row to remove it." },
    { c:'Jobs', q:['how do i delete a job','remove a job','delete a draft','get rid of a job','delete estimate'],
      a:"On the **Home** Recent-drafts list (or the Jobs tab) each row has a **delete** button. Tap it and confirm. Deleting a draft can't be undone, so make sure it's the right one." },
    { c:'Jobs', q:['how do i search for a job','find a client','search jobs','look up a job','filter jobs'],
      a:"Both **Recent drafts** and **Quote activity** on Home have a search box — type a client name or address to filter the list instantly. The **Jobs** tab is also searchable." },
    { c:'Jobs', q:['how do i switch jobs','change the current job','select a different job','load another job','switch to another job'],
      a:"Tap **Select job** (or open the **Jobs** tab / a **Recent drafts** row) and choose the job. The selected job shows in the left sidebar so you always know which one you're editing." },
    { c:'Jobs', q:['how do i rename a job','change client name','edit job details','change the address','update client details'],
      a:"Open the job, then edit the client/address fields (they live in the New-job details and on the Job Pack header). Changes autosave. The quote reference (FR-####) stays with the job." },
    { c:'Jobs', q:['what is quote activity','quote activity feed','accepted quotes list','who accepted','track quotes'],
      a:"**Quote activity** on the Home tab shows recent quote events — sent, opened, accepted, declined or queried — so you can see where each customer is up to at a glance." },

    // ---- Map Roof: background ----
    { c:'Map', q:['how do i add the aerial photo','upload a photo','add background image','import the roof photo','add satellite image','how do i get the roof picture'],
      a:"On **Map Roof**, use the background/aerial step to upload the roof photo (drag-drop or choose a file). You can also use the map to grab an aerial. Once it's in, trace the roof over it." },
    { c:'Map', q:['can i use google maps','satellite view','where do i get an aerial','nearmap','get an aerial image','map image source'],
      a:"Use the built-in map to locate the address and capture the aerial, or upload your own image (a screenshot from a mapping site, a drone shot, or a photo). Any clear top-down image works for tracing." },
    { c:'Map', q:['photo is blurry','image is low quality','cant see the roof clearly','bad aerial','pixelated image'],
      a:"Zoom in before capturing, or upload a sharper source image. You don't need a perfect photo — as long as the roof edges are visible you can trace them, then set the scale from a known length so measurements stay accurate." },
    { c:'Map', q:['no background image','draw without a photo','trace without aerial','skip the photo','can i draw freehand'],
      a:"Yes — you can draw the roof without a background image. Trace the outline on the blank canvas and set the scale/pitch manually. A photo just makes tracing faster and more accurate." },

    // ---- Map Roof: drawing ----
    { c:'Map', q:['how do i trace the roof','draw the outline','draw the roof shape','outline the roof','how to draw the perimeter','trace the edges'],
      a:"Pick the outline tool and click each corner of the roof to place points; close the shape back on the first point. Drag a point to nudge it. The enclosed area becomes your roof for measuring and sheeting." },
    { c:'Map', q:['how do i add a section','multiple roof planes','add another roof face','separate roof areas','add a plane','different pitches'],
      a:"Add each roof plane as its own **section** so the app can pitch and sheet them independently — handy for L-shapes, lean-tos or different pitches. Draw the main outline first, then add sections for the other faces." },
    { c:'Map', q:['how do i draw a ridge','add ridge line','mark the ridge','ridge line tool','draw ridges'],
      a:"Use the line tool and set it to **ridge**, then click along the ridge line. Ridge lengths feed the ridging cut list in the Job Pack. The same tool draws hips, valleys, barges and aprons — just pick the type." },
    { c:'Map', q:['how do i draw a hip','hip line','mark hips','add a hip'],
      a:"Draw a line and set its type to **hip**. Hip (and valley) lines get letter refs on the map and feed the flashing/ridging cut lists. Length auto-calculates from your scale and pitch." },
    { c:'Map', q:['how do i draw a valley','valley line','mark valleys','add a valley','valley flashing line'],
      a:"Draw a line set to **valley**. Valley flashings then appear in the Job Pack cut list with the right length (+ waste). Make sure the pitch is set so the sloped length is correct." },
    { c:'Map', q:['barge','how do i mark a barge','gable edge','barge flashing','draw barge line'],
      a:"Draw a line set to **barge** along the gable edges. Barge flashings feed into the Flashings section of the Job Pack. Length and waste are calculated automatically." },
    { c:'Map', q:['apron','how do i mark an apron','apron flashing','wall flashing','draw apron'],
      a:"Draw a line set to **apron** where the roof meets a wall. It's added to the Flashings cut list. Use change-of-pitch for a break in the roof slope." },
    { c:'Map', q:['penetration','how do i add a pipe','vent','skylight','chimney','flue','add a penetration','mark a pipe','dektite'],
      a:"Use the penetration tool to drop a marker for each pipe, flue, vent or skylight. These feed the consumables list (e.g. dektite boots) in the Job Pack so nothing's missed on the order." },
    { c:'Map', q:['how do i delete a line','remove a line','undo a line','erase a line','delete a point','remove a shape'],
      a:"Select the line or point and delete it (or use undo). You can also drag points to fix a shape rather than redrawing it. Deleting a line removes it from the cut lists too." },
    { c:'Map', q:['how do i move a point','adjust a corner','nudge a point','fix the outline','move a node'],
      a:"Switch to the move/select tool, then drag any point to reposition it. The measurements and sheet plan update automatically when you move things." },

    // ---- Map Roof: view / zoom ----
    { c:'Map', q:['how do i zoom','zoom in','zoom out','make it bigger','magnify','scale the view'],
      a:"Use the zoom controls (or pinch/scroll). Zooming only changes the view — it doesn't change measurements. Use the **Fit** button to frame the whole roof again." },
    { c:'Map', q:['fit to screen','fit button','reset zoom','recenter','frame the roof','fit the roof'],
      a:"The **Fit** button reframes the drawing so the whole roof fits the canvas. Use it any time the view gets lost after zooming or panning." },
    { c:'Map', q:['roof map is zoomed in','map looks zoomed','job pack map zoomed','deep link zoomed','map not fitting'],
      a:"Tap **Fit** to reframe. The Job Pack's embedded map and the Fergus deep-link now auto-fit to the roof, so it should open framed. If it still looks off, hard-refresh the page to clear a cached version." },
    { c:'Map', q:['how do i pan','move the view','drag the canvas','scroll around','shift the image'],
      a:"Use the move tool and drag, or use two fingers on a touch screen. Panning doesn't affect measurements. **Fit** brings everything back into view." },
    { c:'Map', q:['view settings','rotate the roof','rotate view','turn the roof','orientation'],
      a:"View options (including rotate) live in the **View** control on the Map Roof toolbar. Rotating the view helps line things up; it doesn't change the measured lengths." },

    // ---- Pitch / calibration / scale ----
    { c:'Measure', q:['how do i set the pitch','roof pitch','change pitch','set the angle','pitch degrees','what pitch'],
      a:"Set the **pitch** (in degrees) in the calibration/pitch field on Map Roof. Pitch turns your flat (plan) measurements into true sloped lengths and areas, so sheets and flashings come out the right length. Set it before finalising the cut lists." },
    { c:'Measure', q:['how do i calibrate','set the scale','how does it know the size','calibrate measurements','set a known length','scale calibration'],
      a:"Calibrate by drawing a line over something of known length (a wall, a garage door, a supplied dimension) and typing that real length in. The app scales everything else from it, so areas and sheet lengths are accurate." },
    { c:'Measure', q:['measurements are wrong','area is off','sizes look wrong','wrong dimensions','numbers dont match','inaccurate'],
      a:"Two things drive accuracy:\n- **Scale** — recalibrate against a known length.\n- **Pitch** — a wrong pitch makes sloped lengths/areas wrong.\nCheck both, then the cut lists will follow." },
    { c:'Measure', q:['what is the roof area','total area','how big is the roof','square meters','m2','roof size'],
      a:"The roof area (m²) shows in the Job Pack header and on the plan. It's the true (pitched) area based on your outline, scale and pitch — that's what the sheet quantities are built from." },
    { c:'Measure', q:['pitch from ground','measure pitch','how do i find the pitch','work out the pitch','pitch gauge'],
      a:"If you don't know the pitch, measure it on site with a pitch gauge/level app, or estimate from the aerial and confirm on site. Common NZ re-roof pitches are 8°–25°. Enter it in the pitch field so lengths are correct." },

    // ---- Sheets / cut lists ----
    { c:'Sheets', q:['sheet plan','how are sheets calculated','roof sheets','how many sheets','sheet layout','generate sheets'],
      a:"The **sheet plan** tiles the roof into cover-width sheets and lists how many of each length to order, grouped by length. It's driven by your outline, scale and pitch. See it on Map Roof and in the Job Pack cut lists." },
    { c:'Sheets', q:['sheet lengths','how long are the sheets','change sheet length','edit sheet length','wrong sheet length','sheet cut list'],
      a:"Sheet lengths come from the plan. To change one, edit it inline in the **Job Pack cut lists** (click the length or quantity) — the map labels and the Sheets-to-order panel update together." },
    { c:'Sheets', q:['edit sheets','customise the sheet plan','remove a sheet','add a sheet','change quantity','restore sheets'],
      a:"On the sheet plan use **Edit sheets** to tweak the layout, or edit lengths/quantities directly in the Job Pack cut list. **Restore all** puts the auto plan back if you want to start over." },
    { c:'Sheets', q:['what cover width','sheet width','coverage','effective cover'],
      a:"The tiling uses the profile's effective cover width (e.g. Corrugate). Change the **profile** in the Job Pack and the sheet plan re-tiles to that cover width automatically." },
    { c:'Sheets', q:['offcuts','waste','wastage','how much waste','extra material'],
      a:"Flashings add a standard allowance (about +0.4 m per run, split for long runs), and offcuts are handled in the sheet tiling. You can adjust lengths in the cut list if you want to allow more." },

    // ---- Materials / Job Pack ----
    { c:'JobPack', q:['what is the job pack','job pack tab','materials tab','whats in the job pack','job pack designer'],
      a:"The **Job Pack** is the build sheet: profile, steel grade, thickness, colour, gutter, ridging, flashings, cut lists and consumables — everything the crew and the supplier need. From here you can **Save as PDF**, **Print**, **Push to Fergus** or **Order Roof**." },
    { c:'JobPack', q:['what profiles are there','change profile','corrugate','5 rib','multidek','roofing profile','pick a profile'],
      a:"Profiles include **Corrugate**, **5-Rib** and **Multidek**. Change it in the Job Pack — the sheet plan re-tiles to that profile's cover width. Corrugate is the common residential default." },
    { c:'JobPack', q:['steel grade','what grade','colorsteel','maxam','colorzen','armorsteel','change grade','which steel'],
      a:"Grades: **Colorsteel** (default), **Colorsteel Maxam**, **Armorsteel ColorZen** and **Zincalume**. Maxam is NZ Steel's premium pre-painted coil (best coastal warranty); ColorZen is a cheaper painted option; Zincalume is unpainted." },
    { c:'JobPack', q:['thickness','gauge','0.40','0.55','bmt','what thickness','change gauge'],
      a:"Thickness (BMT) is **0.40 g** (standard residential) or **0.55 g** (heavier — better hail/debris resistance, stiffer). Pick it in the Job Pack; it feeds pricing and the order." },
    { c:'JobPack', q:['colour','roof colour','pick a colour','change colour','colorsteel colours','colour chart','what colours'],
      a:"Set the roof colour in the Job Pack, and on the customer Quote's **Selections** page there's a colour picker showing the full standard Colorsteel palette as swatches. Zincalume is unpainted, so it shows *Plain Silver Zincalume* with no colour to choose." },
    { c:'JobPack', q:['flashings','what flashings','add flashing','ridge flashing','barge flashing','apron flashing','change of pitch','flashing list'],
      a:"Flashings (barge, apron, change-of-pitch, valley and ridging) come from the lines you drew on Map Roof — each type has its own cut list with letter refs and length + waste. Add extra flashings or edit lengths in the Job Pack." },
    { c:'JobPack', q:['ridging','ridge cap','hip cap','capping','ridge type','wide ridge'],
      a:"Ridging (ridge + hip capping) is built from your ridge/hip lines. Choose **Standard** or **Wide** ridge in the Job Pack; lengths and waste calculate automatically." },
    { c:'JobPack', q:['consumables','screws','rivets','underlay','paper','how many screws','fasteners','dektite'],
      a:"The Job Pack estimates **consumables** — roofing screws, rivets, underlay/paper and dektite boots (from your penetrations) — based on the roof area and lines drawn, so the order is complete." },
    { c:'JobPack', q:['delivery','deliver to site','deliver to yard','delivery option','where to deliver'],
      a:"Set delivery to **site** or **yard** in the Job Pack / Order checklist. It's included on the supplier order so they know where to send the material." },
    { c:'JobPack', q:['save as pdf','export job pack','print job pack','download job pack','job pack pdf'],
      a:"Use **Save as PDF** (or **Print**) on the Job Pack toolbar to produce the printable build sheet for the crew. It captures the current materials, cut lists and the roof map." },

    // ---- Gutters / downpipes ----
    { c:'Gutter', q:['gutter','spouting','add a gutter','gutter options','box gutter','marley','which gutter','gutter types'],
      a:"Gutter options include **125mm Colorsteel Box Gutter**, **Marley Typhoon (PVC)** and **Marley Classic (PVC)** — or no new gutter. Pick it in the Job Pack, and the customer can choose on the Quote's Selections page (with an add-on price)." },
    { c:'Gutter', q:['brackets','gutter brackets','internal brackets','external brackets','bracket type'],
      a:"Brackets are **External** (clip to the front of the fascia — standard) or **Internal** (sit behind the fascia for a cleaner facade line). The choice appears on the Selections page when a gutter is selected." },
    { c:'Gutter', q:['downpipes','new downpipes','keep downpipes','spouting downpipe','how many downpipes'],
      a:"Downpipes can be kept (re-use existing) or supplied new to match the guttering. It's an option on the Selections page with its own add-on price when a gutter is chosen." },
    { c:'Gutter', q:['no gutter','gutter not needed','skip gutter','remove gutter'],
      a:"Choose **No new gutter** (the default) if the existing spouting stays. On the Order checklist it'll confirm *No gutter required?* so nothing gets ordered by mistake." },

    // ---- Quote / proposal ----
    { c:'Quote', q:['how do i make a quote','build the quote','create proposal','generate quote','make a proposal','quote tab'],
      a:"Open the **Quote** tab — it builds the customer proposal from your job (scope, pricing, options, warranty and the Selections page). Review it, then send it with **Customer link** or **Email quote**." },
    { c:'Quote', q:['how is the price calculated','pricing','how does pricing work','where does the price come from','quote price','labour and materials'],
      a:"The price combines **labour**, **materials**, scaffolding and any options, plus **GST**. Base rates and add-on prices come from **Settings → Quote defaults / price book**. The Selections page shows how each customer choice changes the total." },
    { c:'Quote', q:['gst','tax','plus gst','incl gst','add gst','gst rate'],
      a:"GST is applied at the rate set on the quote (Settings). Prices on the proposal show **incl. GST** so the customer sees the final figure. Change the GST rate in Settings if needed." },
    { c:'Quote', q:['options a and b','quote options','give options','multiple options','package options','upgrade options'],
      a:"You can offer the customer **options/upgrades** (e.g. Maxam vs Endura, different profiles) — each with its own price. They appear on the pricing and Selections pages so the customer can compare and pick." },
    { c:'Quote', q:['scope of work','edit scope','what we do','inclusions','add a scope line','scope lines'],
      a:"The **scope of work** lists what's included. Edit the lines directly on the proposal's scope page (click to edit, add a line). Use it to spell out strip, underlay, fixings, flashings, gutter, rubbish removal, etc." },
    { c:'Quote', q:['warranty','guarantee','how long is the warranty','maxam warranty','warranty zones','perforation warranty'],
      a:"The proposal shows the **Colorsteel MAXAM warranty by coastal zone** (up to 50 yr Mild, 40 yr Moderate, 30 yr Severe, 20 yr Very Severe — perforation) plus your workmanship terms. Alternatives (ColorZen 30 yr, Zincalume 20 yr non-perforation) are shown too." },
    { c:'Quote', q:['selections page','what is the selections page','customer options page','page 4','choose your options'],
      a:"The **Selections** page lets the customer choose steel grade, thickness and colour (left) and guttering, brackets and downpipes (right), plus keep-or-dispose of the old material. Each choice shows its price effect and the running total updates live." },
    { c:'Quote', q:['change fonts','proposal font','make it look professional','quote design','proposal style'],
      a:"The proposal uses an editorial serif for headings with a clean sans body for a professional look. Layout is fixed to A4 so it prints and PDFs cleanly. Your logos and brand photos come from Settings." },
    { c:'Quote', q:['notes to client','add a note','special conditions','client notes','message on quote'],
      a:"There's a **Notes** block on the proposal for client-specific info — access, timing, special considerations. Click to edit; it prints on the quote." },

    // ---- Customer link / sharing / acceptance ----
    { c:'Customer', q:['customer link','share the quote','send to customer','how do i send the quote','get a link','shareable link','link for client'],
      a:"On the Quote tab tap **Customer link** — it creates a shareable web link (and shows it on-screen to copy). The customer opens it on any device, sees the full proposal, picks their options and can accept online." },
    { c:'Customer', q:['email the quote','email quote','send quote by email','emailed proposal'],
      a:"Use **Email quote** to send the proposal, or copy the **Customer link** into your own email/text. The customer link is the interactive version where they can choose options and accept." },
    { c:'Customer', q:['how does the customer accept','accept online','customer acceptance','sign off','approve the quote','accept quote'],
      a:"On the customer link the client types their name, ticks the terms, and taps **Accept**. A confirmation popup summarises their selections and total; when they confirm, the acceptance is recorded and the office is notified (with a PDF)." },
    { c:'Customer', q:['confirmation popup','confirm selections','review before accepting','change selections at acceptance'],
      a:"Before an acceptance is recorded, a popup shows the customer their picks (grade, thickness, colour, gutter, brackets, downpipes, keep/dispose) and the total, with dropdowns to change anything. Nothing is recorded until they tap **Confirm & accept**." },
    { c:'Customer', q:['customer quote doesnt fit phone','mobile view','quote on phone','not fitting screen','responsive'],
      a:"The customer proposal scales to fit the phone's width automatically, and the popups are mobile-sized. If it looks off, ask the customer to refresh — an old cached version can linger." },
    { c:'Customer', q:['did the customer open it','was it viewed','opened the quote','customer viewed','track opens'],
      a:"Quote events (opened, accepted, declined, queried) show in **Quote activity** on the Home tab, so you can see whether the customer has looked at it." },
    { c:'Customer', q:['undo acceptance','unaccept','customer accepted by mistake','reverse acceptance'],
      a:"An accepted quote has an **Undo acceptance** control so a mistaken acceptance can be reversed. The office also sees the event in Quote activity." },
    { c:'Customer', q:['preparing your confirmation slow','accept is slow','takes a long time to accept','20 seconds'],
      a:"Acceptance is recorded immediately and the customer is thanked straight away; the confirmation PDF is built and emailed to the office in the background, so they don't have to wait." },

    // ---- Fergus ----
    { c:'Fergus', q:['fergus','push to fergus','send to fergus','upload to fergus','sync fergus','what is fergus'],
      a:"**Fergus** is your job-management system. From the Job Pack you can **Push to Fergus** (the Job Pack) and push the **Quote**. Each button shows an uploading state then a *sent* confirmation with the date/time." },
    { c:'Fergus', q:['open this job in roofmap','fergus deep link','open in roofmap','link from fergus','back to roofmap'],
      a:"The **Open this job in RoofMap** link in Fergus deep-links straight to that job's **Job Pack** tab with the roof map framed. If it ever opened the wrong view, that's fixed — hard-refresh if you still see it." },
    { c:'Fergus', q:['fergus not sending','push failed','fergus error','didnt upload to fergus'],
      a:"If a push doesn't confirm, check your connection and try again — the button will show uploading then a sent time on success. If it keeps failing, confirm the Fergus settings/credentials are in place." },

    // ---- Order Roof / supplier ----
    { c:'Order', q:['order roof','order the roof','order materials','send order to supplier','supplier order','how do i order','place an order'],
      a:"Tap **Order Roof** in the Job Pack. A **checklist** pops up first — confirm sheet lengths, colour, gutter, grade + thickness, profile, flashings, pitch and delivery (you can edit each inline). When every item is ticked, it opens a pre-filled supplier order email." },
    { c:'Order', q:['order checklist','what is the checklist','confirm before ordering','checklist popup'],
      a:"The **order checklist** is a safety step before ordering. It lists the key specs with the selected values and inline controls to change them; the cut list is shown so you can double-check sheet lengths. The order can't send until all items are confirmed." },
    { c:'Order', q:['supplier email','who do i order from','change supplier','order email address','supplier contact'],
      a:"Suppliers (and their contact/first name and email) are set in **Settings**. The Order Roof email is pre-filled to the chosen supplier with your spec and cut list — you just review and send." },

    // ---- Settings ----
    { c:'Settings', q:['settings','where are settings','change company details','company info','update details','preferences'],
      a:"The **Settings** tab holds your company details, suppliers, price book / quote defaults, GST rate and brand photos. Set these up once and every job/quote uses them." },
    { c:'Settings', q:['change price','update pricing','price book','set rates','labour rate','material price','edit prices'],
      a:"Update rates in **Settings → price book / quote defaults** — labour, materials, gutter and option add-ons, GST. New quotes use these; existing quotes keep their saved figures." },
    { c:'Settings', q:['add a supplier','supplier settings','new supplier','supplier details','supplier first name'],
      a:"In **Settings**, add each supplier with their name, contact first name and email. That contact is used to personalise the Order Roof email." },
    { c:'Settings', q:['company logo','change logo','upload logo','brand photos','stock photos','hero photo','crew photo'],
      a:"Upload your logo and reusable brand/stock photos in **Settings** (past-job shots, crew photo, hero images). They appear across the proposal cover and marketing pages. Site-specific photos are added under the inspection instead." },
    { c:'Settings', q:['gst rate setting','change gst','set tax rate'],
      a:"The GST rate is in **Settings** (Quote defaults). It flows into every quote's incl-GST pricing." },
    { c:'Settings', q:['logos on the quote','trust logos','ranz','site safe','sitewise','lbp','colorsteel authorised','member logos'],
      a:"The proposal footer shows your credential logos — **Roofing Association NZ (RANZ)**, Licensed Building Practitioner, Site Safe, Sitewise Gold and Colorsteel Authorised. To swap in official artwork, upload the file and it replaces the placeholder." },

    // ---- Account / login ----
    { c:'Account', q:['how do i log in','login','sign in','cant log in','password','forgot password','log out'],
      a:"Log in with your Flood Roofing email and password on the start screen. If you can't get in, check the email/password, then contact the office to reset it. Use **Log out** from the app to switch accounts." },
    { c:'Account', q:['who can see my jobs','is my data private','data security','shared jobs','account access'],
      a:"Jobs are tied to your login/device. The only thing customers see is the **Customer link** you send them — that shows just their proposal, not your other jobs or pricing setup." },

    // ---- Troubleshooting ----
    { c:'Help', q:['its not working','something is broken','bug','error','glitch','not responding','app broken'],
      a:"Try these in order:\n- **Hard-refresh** the page (clears a cached old version)\n- Re-open the job from the Jobs tab\n- Check your internet connection\nIf it still misbehaves, tell the office exactly what you tapped and what happened." },
    { c:'Help', q:['not saving','changes lost','work disappeared','didnt save','lost my job'],
      a:"Jobs autosave, but they save to **this browser/login**. If work seems missing, open the same device/login and check the **Jobs** tab. Avoid private/incognito windows, which can clear storage." },
    { c:'Help', q:['pdf not generating','pdf blank','pdf broken','cant make pdf','pdf failed','export not working'],
      a:"If a PDF won't build, hard-refresh and try again (the PDF tools load on demand and need a moment). Make sure images have loaded first. On a very large job give it a few seconds to render each page." },
    { c:'Help', q:['images not loading','photos missing','logo not showing','broken image','picture wont load'],
      a:"A missing image usually means the file didn't upload or the connection dropped — re-upload it in Settings or the inspection. Missing brand logos self-hide so they don't break the layout." },
    { c:'Help', q:['price pushed off the page','overflow','content cut off','logos cut off','doesnt fit the page'],
      a:"The Selections/pricing page is tuned to fit one A4 sheet even with every option changed. If something still looks clipped, hard-refresh to load the latest version." },
    { c:'Help', q:['offline','no internet','works offline','internet down'],
      a:"Most editing works in the browser, but sending the customer link, emailing, Fergus push and map aerials need internet. Your job data stays saved locally until you're back online." },
    { c:'Help', q:['clear cache','hard refresh','old version','stale version','update the app','not the latest'],
      a:"To force the latest version, **hard-refresh**: on desktop Ctrl/Cmd+Shift+R; on mobile, pull-to-refresh or close and reopen the tab. This clears a cached older build." },

    // ---- Roofing knowledge ----
    { c:'Roofing', q:['what is colorsteel','colorsteel explained','about colorsteel','maxam explained','activate coating'],
      a:"**Colorsteel** is NZ Steel's pre-painted roofing steel. **MAXAM** is the premium line, built on **Activate™** — an aluminium-zinc-magnesium coating that slows corrosion, giving up to 50-yr perforation warranty in mild zones. Rolled and painted at Glenbrook from NZ iron sand." },
    { c:'Roofing', q:['what is zincalume','zincalume explained','plain silver','unpainted steel','al zn alloy','does zincalume need painting'],
      a:"**Zincalume** is unpainted aluminium-zinc (Al/Zn) alloy-coated steel — natural silver. The coating self-weathers to resist corrosion, so **no painting is needed**. Repainting after ~20 years extends its life further. It carries a 20-yr non-perforation warranty and is the lowest-cost option." },
    { c:'Roofing', q:['colorzen','armorsteel','endura','cheaper steel','budget steel'],
      a:"**Armorsteel ColorZen** is a cheaper pre-painted alternative to Colorsteel — solid coating and colour range, ~30-yr warranty in mild environments, with less corrosion protection in coastal zones than MAXAM." },
    { c:'Roofing', q:['coastal zone','how close to the sea','sea spray','corrosion zone','marine environment','distance from surf'],
      a:"Warranty and material choice depend on distance to breaking surf: **Mild** (5 km+), **Moderate** (500 m–1 km), **Severe** (100–500 m), **Very Severe** (25–100 m). Closer to the coast = shorter perforation warranty; MAXAM is best for coastal jobs." },
    { c:'Roofing', q:['what pitch can i use','minimum pitch','low pitch roof','corrugate minimum pitch','pitch for long run'],
      a:"Long-run steel (corrugate/trapezoidal) is generally fine down to low residential pitches, but very low pitches need extra care with laps/underlay per the manufacturer. Confirm the site pitch and follow NZ Steel/COP guidance for the profile." },
    { c:'Roofing', q:['difference between profiles','corrugate vs 5 rib','which profile is best','profile comparison'],
      a:"**Corrugate** is the classic wavy residential profile; **5-Rib/Trapezoidal** has trapezoidal ribs (often lower-pitch, commercial/modern look); **Multidek** is a wider trapezoidal deck. Cover width differs, which changes sheet counts." },
    { c:'Roofing', q:['strip and re-roof','tile to colorsteel','tile conversion','re-roof process','strip existing roof'],
      a:"A typical re-roof strips the old roof (or over-purlins for tile-to-steel), lays underlay, then fixes the new long-run steel, flashings and gutter. The scope-of-work page on the quote spells out exactly what's included." },
    { c:'Roofing', q:['dispose of old material','keep old iron','scrap steel','remove old roof','rubbish removal'],
      a:"On the Selections page the customer chooses **keep** the old material on site or have **us dispose** of it. Both are the same price — the scrap value of the old steel only offsets the labour/time to strip and cart it away." },

    // ---- Misc / meta ----
    { c:'Help', q:['who do i contact','support','help','phone number','contact flood roofing','call the office','get help'],
      a:"For anything this assistant can't answer, contact the office — **office@floodroofing.co.nz** or **0800 4 FLOOD**. For a customer-facing question, the same details are on every proposal." },
    { c:'Help', q:['what can you do','what can i ask','help me','options','what do you know','can you help'],
      a:"I can help with the whole app — jobs & drafts, mapping and measuring a roof, sheet plans and cut lists, the Job Pack materials, gutters and flashings, building and sending quotes, customer acceptance, Fergus, ordering from the supplier, settings, and general roofing/Colorsteel questions. Just ask in your own words." },
    { c:'Help', q:['thanks','thank you','cheers','ta','appreciate it'],
      a:"You're welcome! Ask me anything else about RoofMap or the quote workflow." },
    { c:'Help', q:['hello','hi','hey','gday','kia ora','good morning'],
      a:"Hi! I'm the RoofMap help assistant. Ask me anything about mapping a roof, building a Job Pack, sending a quote, or ordering — or tap one of the suggestions below." }
  ];

  // ── Extended topics (more specific FAQs) ──────────────────────────────
  Array.prototype.push.apply(FRQA, [
    { c:'Jobs', q:['duplicate a job','copy a job','clone a job','reuse a quote','same job again','template job'],
      a:"To reuse a job, open it and **Save** — or start a new job and re-enter the details. You can also save a job's quote as your **default template** so new quotes start from it (Save as default template on the Quote toolbar)." },
    { c:'Jobs', q:['default template','save as default template','set a template','starting template'],
      a:"**Save as default template** (Quote toolbar) stores the current quote's layout, scope and defaults so every new quote starts from it. Handy once you've got a proposal you like." },
    { c:'Jobs', q:['multiple roofs one job','more than one roof','several buildings','shed and house','two roofs'],
      a:"You can map multiple roof planes/sections in one job, and the sheet plan handles them together. For genuinely separate buildings, it's usually cleaner to make a job each so the quotes stay distinct." },
    { c:'Quote', q:['quote reference','fr number','change reference','ref number','quote id'],
      a:"Each job gets a quote reference like **FR-####** automatically. It shows on the proposal header/footer and travels with the job so you can quote it in conversation." },
    { c:'Quote', q:['how long is the quote valid','validity','expiry','valid for 30 days','quote expiry'],
      a:"The proposal shows a **Valid** period (default 30 days) on the cover. Adjust it if you need a shorter/longer window; after that you'd re-issue with current pricing." },
    { c:'Quote', q:['scaffolding','scaffold price','edge protection','add scaffolding','staging'],
      a:"Scaffolding/edge protection is part of the quote build — add it as a scaffold line (type + price) and it flows into the total. Set typical rates in Settings so it's quick to add." },
    { c:'Quote', q:['add labour','labour cost','set labour','labour manually','change labour'],
      a:"Labour feeds the quote from your job figures/price book. You can adjust the labour and materials line items when building the quote; totals recalculate with GST." },
    { c:'Quote', q:['markup','margin','profit','add margin','marked up'],
      a:"Build your margin into the labour/material rates in the **Settings price book**, or adjust the line items on the quote. The customer sees a single professional price, not your cost breakdown." },
    { c:'Quote', q:['discount','give a discount','reduce the price','take money off','special price'],
      a:"To discount, adjust the relevant line item or total when building the quote. Keep the scope the same so it's clear what's included at the agreed price." },
    { c:'Quote', q:['deposit','payment terms','how do they pay','progress payment','invoice terms'],
      a:"Payment/deposit terms belong in your quote's terms or the Notes block. Invoicing itself is handled in **Fergus** — push the job across once it's accepted." },
    { c:'Quote', q:['resend the quote','send again','re-send','update and resend','send a new version'],
      a:"Make your changes, then share the **Customer link** again (same link reflects the latest version) or **Email quote** again. The customer always sees the current proposal at the link." },
    { c:'Customer', q:['declined','customer declined','quote rejected','they said no','declined meaning'],
      a:"**Declined** in Quote activity means the customer chose not to proceed. You can follow up, adjust the quote, and re-send the link if things change." },
    { c:'Customer', q:['queried','customer has a question','queried meaning','they queried','question raised'],
      a:"**Queried** means the customer flagged a question rather than accepting/declining. Give them a call, sort it out, update the quote if needed and re-send." },
    { c:'Customer', q:['edit after accepted','change an accepted quote','accepted but need to change','revise accepted'],
      a:"If something must change after acceptance, use **Undo acceptance**, edit the quote, and have the customer accept again — or handle the variation in Fergus so there's a clear record." },
    { c:'Customer', q:['copy the link','copy customer link','copy paste link','link to copy'],
      a:"When you tap **Customer link**, the link is shown on-screen with a copy option so you can paste it into your own text or email as well as sending it directly." },
    { c:'JobPack', q:['job pack pdf vs quote pdf','difference pdf','which pdf','two pdfs'],
      a:"The **Job Pack PDF** is the internal build sheet (materials, cut lists, map) for the crew/supplier. The **Quote PDF** is the polished customer proposal. Different audiences — send the quote to customers, the job pack to the crew." },
    { c:'JobPack', q:['add a flashing manually','custom flashing','extra flashing','flashing not drawn','add cut list row'],
      a:"In the Job Pack cut lists you can **add a row** for an extra flashing/piece (girth, folds, length, qty). It's included in pricing and the order alongside the drawing-derived flashings." },
    { c:'JobPack', q:['girth','folds','flashing girth','how wide is the flashing','bends'],
      a:"A flashing's **girth** (total developed width) and **folds/bends** drive its price from the supplier table. Set them on the saved flashing so the cut list can price it per lineal metre." },
    { c:'Photos', q:['add site photos','inspection photos','job photos','upload site pictures','photos of this roof'],
      a:"Add site-specific photos under the **inspection** for the job — they appear on the Project details page of that proposal. Reusable brand/stock photos live in **Settings** and show across every proposal." },
    { c:'Photos', q:['change the crew photo','team photo','staff picture','crew image','change team photo'],
      a:"The crew/team photo is a brand image set in **Settings** (and used on the cover/acceptance pages). Upload a new one there and it updates across proposals." },
    { c:'Photos', q:['hero image','cover photo','change cover image','main photo','banner image'],
      a:"The cover/hero image is one of your brand photos in **Settings**. Swap it there to change what leads the proposal." },
    { c:'Photos', q:['portfolio','past jobs photos','gallery','example photos','stock photos'],
      a:"Upload a handful of your best past-job/Colorsteel photos once in **Settings** — they're reused as the portfolio/gallery across every proposal, so you don't re-add them each time." },
    { c:'Inspect', q:['inspection','site inspection','condition report','existing roof condition','moisture','report'],
      a:"Record the existing-roof condition and site notes in the job's inspection. Site photos and notes there feed the Project details page of the proposal so the customer sees you've assessed it." },
    { c:'Roofing', q:['fascia','soffit','eaves','what is fascia','replace fascia'],
      a:"**Fascia** is the board along the eave that the gutter fixes to; the **soffit** is the underside lining. If they need work, note it in the scope — the quote can include fascia/soffit as a scope line." },
    { c:'Roofing', q:['purlins','battens','fixing centres','screw spacing','how far apart screws','fastener spacing'],
      a:"Fixing centres depend on the profile, wind zone and purlin spacing per the manufacturer/NZ code. The consumables estimate assumes typical residential spacing; adjust on site to the actual purlin layout." },
    { c:'Roofing', q:['underlay','building paper','self supporting underlay','netting','breather','what underlay'],
      a:"A synthetic roofing **underlay** (breather-type) goes under long-run steel; low pitches or wide purlin spacing may need self-supporting underlay or netting. The consumables list allows for underlay based on area." },
    { c:'Roofing', q:['lap','side lap','end lap','overlap sheets','sheet lap'],
      a:"Long-run steel side-laps by one rib; end-laps (when sheets aren't full length) follow the profile/pitch rules. On low pitches, longer end-laps or sealed laps are used — the sheet plan aims for single lengths where it can." },
    { c:'Roofing', q:['wind zone','high wind','exposure','wind rating','wind load'],
      a:"Wind zone affects fixing centres and sometimes the gauge. For high/very-high wind sites, fixings are closer and 0.55g may be worth it. Confirm the site's wind zone and fix to spec." },
    { c:'Roofing', q:['building consent','council','permit','do i need consent','consent for reroof'],
      a:"A like-for-like re-roof often doesn't need consent, but changes (structure, adding penetrations, altering pitch) can. Check with the council; note any consent requirement in the scope/terms." },
    { c:'Roofing', q:['ventilation','ridge vent','roof ventilation','condensation','airflow'],
      a:"Ventilation (ridge vents, eave intake) manages condensation under steel. If the roof needs venting, add it as a scope/flashing line. Note any existing condensation issues in the inspection." },
    { c:'Roofing', q:['repair','partial reroof','fix a leak','patch','small job','repair quote'],
      a:"For a repair or partial re-roof, map only the affected area/lines and build a scope to match (e.g. re-screw, replace ridge, patch a section). The same tools work for small jobs." },
    { c:'Roofing', q:['re-screw','rescrew','replace screws','tighten screws','fastener replacement'],
      a:"A re-screw job replaces old/leaking fasteners. Quote it via the scope with a per-fastener or lump price and note the roof area — you don't need a full sheet plan for it." },
    { c:'Roofing', q:['moss','lichen','roof wash','clean the roof','treatment','soft wash'],
      a:"Moss/lichen treatment and roof washing can be added as scope lines. They're maintenance items rather than a re-roof — describe the treatment and area in the quote." },
    { c:'Roofing', q:['deck','measure a deck','flat area','balcony','measure a slab'],
      a:"You can trace any flat plan area to get its size, but the sheet plan is built for pitched roofs. For a deck/membrane area, use the measurement and quote it via the scope." },
    { c:'Measure', q:['how accurate','accuracy','are measurements exact','precision','trust the numbers'],
      a:"Accuracy depends on your **scale calibration** and **pitch**. Calibrated well, the plan is close enough to order confidently, but always sanity-check critical lengths on site before cutting." },
    { c:'Measure', q:['units','metric','millimetres','meters','imperial','feet'],
      a:"The app works in **metric** (mm/m, m²) as used in NZ roofing. Sheet lengths show in metres; girths in mm." },
    { c:'View', q:['keyboard shortcuts','hotkeys','shortcuts','undo redo keys'],
      a:"Core actions have on-screen buttons (undo, delete, fit, tools). Use the toolbar controls on Map Roof; there's an undo for drawing mistakes and **Fit** to reframe." },
    { c:'View', q:['dark mode','night mode','theme','light or dark'],
      a:"The app uses a single clean light theme tuned for on-site readability and accurate colour swatches; there isn't a separate dark mode." },
    { c:'Account', q:['change my password','reset password','new password','update password'],
      a:"To change or reset your password, contact the office to update your login. Keep your credentials private — the customer link is the only thing customers ever see." },
    { c:'Account', q:['add a user','new team member','another login','staff account','more users'],
      a:"New logins are set up by the office. Ask them to add a team member's account; each person signs in with their own email." },
    { c:'Settings', q:['company address','change address','business details','abn','nzbn','gst number'],
      a:"Your company name, address, phone, email and GST number are in **Settings** and print on the proposal letterhead. Update them there and every new quote uses the new details." },
    { c:'Settings', q:['change company name','rename company','business name on quote'],
      a:"Set the business name in **Settings** — it appears on the proposal header/footer and the supplier order." },
    { c:'Order', q:['order wrong','fix an order','made a mistake on order','re-order','change an order'],
      a:"The Order Roof step just pre-fills an email to the supplier — nothing is locked in until you send it. Re-open Order Roof, correct the specs in the checklist, and send an updated order (or reply to the supplier)." },
    { c:'Order', q:['what gets ordered','order contents','whats on the order','order includes'],
      a:"The supplier order includes the sheet cut list, ridging, gutter (if selected), flashings, colour, grade + thickness, profile, pitch and delivery — everything from the Job Pack, laid out for the supplier." },
    { c:'Fergus', q:['sent time to fergus','when was it pushed','fergus timestamp','confirmation date'],
      a:"After a successful **Push to Fergus**, the button shows a *sent* confirmation with the date and time so you know it went across and when." },
    { c:'Quote', q:['whats on each proposal page','proposal pages','pages of the quote','what pages','proposal structure'],
      a:"A typical proposal runs: **Cover** → existing condition/team → pricing & inclusions → **Selections** (customer options) → Colorsteel material & colours → gutters → warranty/terms → acceptance. Empty sections are skipped automatically." },
    { c:'Quote', q:['remove a page','hide a page','add a page','proposal sections','turn off a section'],
      a:"Proposal sections show only when they have content, so unused ones drop out. Add or edit content (scope, options, photos) and the matching page appears; clear it and the page disappears." },
    { c:'Quote', q:['acceptance page','sign here','where do they sign','acceptance section'],
      a:"The **acceptance** page is where the customer types their name, ticks the terms and taps Accept. On the customer link it's interactive; on the PDF it shows the summary and terms." },
    { c:'Roofing', q:['solar','solar panels','pv','battery','solar ready'],
      a:"Solar isn't part of the estimator, but note any solar (existing or planned) in the inspection/scope so penetrations and access are allowed for. Coordinate the solar installer separately." },
    { c:'Roofing', q:['insulation','insulate the roof','r value','blanket'],
      a:"Roof insulation/blanket can be added as a scope line if you're supplying it. The estimator focuses on the roof cladding, flashings and gutter." },
    { c:'Roofing', q:['snow','alpine','snow load','cold climate'],
      a:"Snow/alpine sites affect fixings, laps and sometimes profile choice. Follow the manufacturer's cold-climate guidance and note any snow requirements in the scope." },
    { c:'Roofing', q:['skylight replacement','new skylight','velux','roof window'],
      a:"Mark skylights as penetrations on the map and include supply/install and flashing in the scope. Skylight units are usually supplied to match the new roof and flashed in." },
    { c:'Help', q:['is it free','cost of the app','subscription','how much does roofmap cost'],
      a:"RoofMap is Flood Roofing's internal tool — there's no charge to you as a user. Questions about the business side go to the office." },
    { c:'Help', q:['feedback','suggestion','feature request','i want a feature','improve the app'],
      a:"Great — pass feature ideas to the office and they can be built in. Be specific about what you'd tap and what should happen, and it's much easier to add." },
    { c:'Help', q:['print','how do i print','printer','print the quote','print out'],
      a:"Use **Print / PDF** on the Quote (or **Print** on the Job Pack). It formats to A4 pages so it prints cleanly. To keep a file, choose Save as PDF instead of a physical printer." },
    { c:'Help', q:['email settings','sending email','email not sending','mail setup'],
      a:"Emailing uses the app's send service. If a send fails, check your connection and try again, or copy the **Customer link** into your own email as a fallback. Email defaults are in Settings." },
    { c:'Roofing', q:['change of pitch','pitch break','apron between pitches','step in roof'],
      a:"A **change-of-pitch** flashing covers a break where the roof slope changes. Draw a change-of-pitch line on the map and it's added to the flashings cut list with the right length + waste." },
    { c:'Roofing', q:['ridge vent','vented ridge','breathable ridge'],
      a:"A vented ridge lets warm/moist air escape at the top of the roof. If specified, add it in place of standard ridging and note it in the scope; it changes the ridge detail and cost." },
    { c:'Gutter', q:['downpipe size','80mm downpipe','how many downpipes needed','downpipe spacing'],
      a:"Downpipe number/size depends on roof catchment and rainfall. As a rule of thumb one downpipe serves a limited gutter length; add new downpipes on the Selections page and confirm the count on site." },
    { c:'Quote', q:['terms and conditions','t and c','terms','fine print','conditions'],
      a:"The proposal includes your standard terms (standard Colorsteel colours, MAXAM warranty by zone, workmanship, variations). They print on the terms page and the customer confirms them at acceptance." },
    { c:'Map', q:['find the address','search address','locate property','type in address','go to a location','gps'],
      a:"Use the address/map search on Map Roof to jump to the property, then capture the aerial. If the search can't find it, drop in your own uploaded image instead." },
    { c:'Map', q:['label a line','name a line','line reference','letter on line','line label'],
      a:"Hip/valley and flashing lines get **letter refs** automatically (A, B, C…) that show on the map and against each flashing in the cut list, so the crew can match a cut piece to a spot on the roof." },
    { c:'Measure', q:['manually set a length','override length','type a length','fixed length','enter measurement'],
      a:"You can override a line's length or a sheet length by editing it in the cut list. Manual overrides stick until you change them, so use them when a site measurement differs from the plan." },
    { c:'Selections', q:['what does included mean','included','no price change','why does it say included','standard included'],
      a:"**Included** means that choice doesn't change the price — it's part of the base quote or a same-price alternative. Options that add cost show a **+ $** amount, and cheaper ones show a **− $**." },
    { c:'Selections', q:['what does standard mean','standard included','default option','standard choice'],
      a:"**Standard** marks the default option for each group (e.g. 0.40 gauge, external brackets). It's already in the quoted price; switching to a non-standard option updates the total." },
    { c:'Selections', q:['new total','running total','updated total','why did the total change','total changed'],
      a:"The **New total** on the Selections/acceptance panel is your base quote plus/minus the customer's option changes, incl. GST. It updates live as they pick, so they always see the real figure." },
    { c:'Selections', q:['select colour prompt','multi coloured box','rainbow swatch','no colour chosen','why rainbow','pick a colour box'],
      a:"The **multi-colour swatch + 'Select colour'** means no colour has been chosen yet — there's no default. Tap it to open the Colorsteel swatch picker and choose one; the box then shows that colour." },
    { c:'Selections', q:['colour picker','swatch popup','colour samples','see all colours','colour chart popup'],
      a:"On the Selections page tap the **Colour** row to open a popup showing every standard Colorsteel colour as a sample tile. Tap one to select it — it highlights with a check and updates everywhere." },
    { c:'Selections', q:['white box instead of colour','colour swatch white','swatch not showing'],
      a:"A blank/rainbow swatch means no colour is selected yet. Tap the Colour row and pick from the swatch popup. For Zincalume there's no colour to choose — it shows *Plain Silver Zincalume*." },
    { c:'Quote', q:['prepared by','salesperson','who prepared it','estimator name','change prepared by','rep name'],
      a:"The **Prepared by** name (and role) shows on the cover. It comes from your login/settings — update it there so proposals carry the right salesperson." },
    { c:'Quote', q:['change valid days','valid period','30 day validity','shorten validity','how many days valid'],
      a:"The cover's **Valid** period defaults to 30 days. Change it when building the quote if you want a shorter or longer window before the pricing needs revisiting." },
    { c:'Customer', q:['text the customer','sms','whatsapp','share by text','send link by message'],
      a:"Copy the **Customer link** and paste it into a text/WhatsApp/message — it opens the interactive proposal on their phone. The on-screen copy button makes this quick." },
    { c:'Customer', q:['proposal too small','cant read on phone','zoom the quote','make quote bigger','pinch to zoom quote'],
      a:"The customer proposal auto-fits the phone width so it's readable, and the customer can pinch-zoom for detail. If it opens tiny or clipped, a refresh usually fixes a cached version." },
    { c:'Help', q:['add to home screen','install the app','app icon','pwa','shortcut on phone'],
      a:"Open the app in your phone browser and use the browser's **Add to Home screen** option for a one-tap icon. It runs in the browser — no app-store install needed." },
    { c:'Help', q:['save to phone','download to device','save the pdf to my phone','keep a copy'],
      a:"Use **Save as PDF** and your device will save the file (Downloads/Files). From there you can share it, print it, or attach it to an email." },
    { c:'JobPack', q:['sticky action bar','buttons follow me','toolbar scrolls','action buttons at top'],
      a:"The Job Pack and Quote action bars (Save, PDF, Push to Fergus, Order Roof) **stick to the top** as you scroll, so the main actions are always in reach on long pages." },
    { c:'Map', q:['aerial too tall','map fills the screen','background too big','collapse the aerial','map height'],
      a:"The aerial/background step is capped in height and can be collapsed once you've traced, so it doesn't dominate the screen while you work on the drawing and cut lists." },
    { c:'JobPack', q:['change of pitch flashing','pitch change cut list','where is change of pitch'],
      a:"Change-of-pitch flashings appear in the **Flashings** section of the Job Pack once you've drawn a change-of-pitch line on the map — with letter ref, length and waste like the other flashings." },
    { c:'Roofing', q:['colorcote','pacific coilcoaters','colorcote warranty','is colorcote good'],
      a:"**ColorCote®** is Pacific Coilcoaters' premium pre-painted steel — an excellent-finish alternative comparable to MAXAM, with up to ~30-yr perforation warranty (zone-dependent). It's offered as a grade option on the Selections page." },
    { c:'Roofing', q:['multidek','trapezoidal','5 rib profile','wide rib','commercial profile'],
      a:"**Multidek/5-Rib (trapezoidal)** profiles have wider, squarer ribs — often used on lower pitches and for a modern/commercial look. They cover differently to corrugate, so the sheet count changes when you switch profile." },
    { c:'Order', q:['double check cut list','verify sheet lengths order','review before ordering','check measurements before order'],
      a:"The Order checklist shows the **cut-list summary** (sheet lengths + flashing measures) right in the popup so you can eyeball the numbers before sending. To change them, edit the Job Pack cut lists, then re-open Order Roof." },
    { c:'Help', q:['loading spinner stuck','stuck loading','wont load','spinner forever','frozen'],
      a:"If it's stuck, wait a few seconds (big jobs/PDFs take a moment), then hard-refresh and re-open the job. If a specific action hangs every time, tell the office exactly which button." },
    { c:'Roofing', q:['what gauge for coastal','coastal thickness','best steel for the sea','coastal recommendation','near the beach'],
      a:"For coastal jobs, **Colorsteel MAXAM** gives the best perforation warranty by zone, and **0.55g** adds durability. The closer to breaking surf, the more it matters — check the coastal zone for the warranty tier." },
    { c:'Gutter', q:['quarter round','half round','colonial','gutter profile shape','spouting profile'],
      a:"Gutter profile shape (quarter-round, half-round, colonial/box) is chosen with the gutter type. The Colorsteel **125mm box gutter** is the higher-capacity metal option; Marley PVC covers the classic/typhoon profiles." },
    { c:'JobPack', q:['barge cap','gable flashing','verge','edge flashing','barge board cover'],
      a:"The **barge/verge** flashing caps the gable edge. Draw barge lines on the map and they're listed under Flashings with length + waste, ready for the order." },
    { c:'Quote', q:['send job pack to crew','give the crew the plan','crew copy','builder copy','installer pack'],
      a:"Give the crew the **Job Pack** — Save as PDF (or Print) and send it, or push it to **Fergus** where they can open it. It has the map, cut lists and consumables they need on site." },
    { c:'Selections', q:['keep existing material meaning','dispose meaning','why same price disposal','scrap value','old iron price'],
      a:"Keeping vs disposing the old roof is the **same price**: the scrap value of the old steel only offsets the labour/time to strip and cart it away, so it's a wash either way. The customer just picks what suits them." },
    { c:'Help', q:['how do i close the help','hide the chat','close chatbot','minimise help'],
      a:"Tap the ✕ in the help panel's top corner to close it; the **Help** button returns at the bottom-right so you can re-open any time." }
  ]);

  // ── Matcher ───────────────────────────────────────────────────────────
  var STOP = {};
  ('a an the is are do does how i my me you your it this that of to in on for with can could would should what when where which who why will and or but if my our we us at be as by from get got any some').split(' ').forEach(function (w) { STOP[w] = 1; });

  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function toks(s) { return norm(s).split(' ').filter(function (w) { return w && !STOP[w]; }); }

  function scoreEntry(userText, userTok, entry) {
    var uset = {}; userTok.forEach(function (t) { uset[t] = 1; });
    var best = 0;
    for (var i = 0; i < entry.q.length; i++) {
      var tt = toks(entry.q[i]);
      if (!tt.length) continue;
      var overlap = 0;
      for (var j = 0; j < tt.length; j++) if (uset[tt[j]]) overlap++;
      var cover = overlap / tt.length;                    // how much of the trigger the user hit
      var recall = overlap / Math.max(1, userTok.length); // how much of the user's message matched
      var phrase = userText.indexOf(norm(entry.q[i])) >= 0 ? 0.5 : 0;
      var sc = cover * 0.7 + recall * 0.3 + phrase;
      if (sc > best) best = sc;
    }
    return best;
  }

  function search(text) {
    var uT = toks(text);
    if (!uT.length) return { best: null, alts: [] };
    var scored = FRQA.map(function (e) { return { e: e, s: scoreEntry(norm(text), uT, e) }; })
      .sort(function (a, b) { return b.s - a.s; });
    var best = scored[0] && scored[0].s >= 0.34 ? scored[0].e : null;
    var alts = scored.filter(function (x) { return x.s >= 0.2 && x.e !== best; }).slice(0, 3).map(function (x) { return x.e; });
    return { best: best, alts: alts };
  }

  // ── Rendering helpers ─────────────────────────────────────────────────
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(a) {
    var lines = esc(a).split('\n'), out = '', inList = false;
    lines.forEach(function (ln) {
      var m = ln.match(/^\s*[-•]\s+(.*)$/);
      if (m) { if (!inList) { out += '<ul style="margin:5px 0 5px 2px;padding-left:16px">'; inList = true; } out += '<li style="margin:2px 0">' + m[1] + '</li>'; }
      else { if (inList) { out += '</ul>'; inList = false; } if (ln.trim()) out += '<div style="margin:4px 0">' + ln + '</div>'; }
    });
    if (inList) out += '</ul>';
    return out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  var CHIPS = ['How do I start a new job?', 'How do I trace the roof?', 'How is the price calculated?', 'How do I send the quote to a customer?', 'How do I order the roof?', 'What is Zincalume?'];

  // ── UI ────────────────────────────────────────────────────────────────
  var openState = false;

  function build() {
    if (document.getElementById('frHelpLauncher')) return;

    var launcher = document.createElement('button');
    launcher.id = 'frHelpLauncher';
    launcher.className = 'no-print';
    launcher.setAttribute('aria-label', 'Open help assistant');
    launcher.innerHTML = '<span style="font-size:20px;line-height:1">💬</span><span style="font-weight:700;font-size:13px">Help</span>';
    launcher.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99000;display:flex;align-items:center;gap:8px;padding:11px 16px;background:#0099cc;color:#fff;border:none;border-radius:30px;box-shadow:0 6px 20px rgba(0,153,204,.4);cursor:pointer;font-family:Inter,system-ui,sans-serif';
    launcher.onclick = function () { toggle(true); };
    document.body.appendChild(launcher);

    var panel = document.createElement('div');
    panel.id = 'frHelpPanel';
    panel.className = 'no-print';
    panel.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99001;width:min(384px,94vw);height:min(580px,82vh);background:#fff;border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.32);display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif';
    panel.innerHTML =
      '<div style="padding:14px 16px;background:#0a1628;color:#fff;display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:20px">💬</span>' +
        '<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;line-height:1.2">RoofMap Help</div>' +
          '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Ask me anything about the app</div></div>' +
        '<button id="frHelpClose" aria-label="Close" style="background:rgba(255,255,255,.12);border:none;color:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:15px">✕</button>' +
      '</div>' +
      '<div id="frHelpMsgs" style="flex:1;overflow-y:auto;padding:14px;background:#f7fafc;-webkit-overflow-scrolling:touch"></div>' +
      '<div id="frHelpChips" style="padding:8px 12px 0;display:flex;gap:6px;flex-wrap:wrap;background:#fff;border-top:1px solid #eef2f6"></div>' +
      '<div style="padding:10px 12px 12px;background:#fff;display:flex;gap:8px;align-items:flex-end">' +
        '<textarea id="frHelpInput" rows="1" placeholder="Type your question…" style="flex:1;resize:none;max-height:90px;box-sizing:border-box;font-family:inherit;font-size:14px;padding:9px 11px;border:1px solid #d3dce6;border-radius:10px;outline:none"></textarea>' +
        '<button id="frHelpSend" aria-label="Send" style="flex-shrink:0;width:40px;height:40px;background:#0099cc;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:16px">➤</button>' +
      '</div>';
    document.body.appendChild(panel);

    document.getElementById('frHelpClose').onclick = function () { toggle(false); };
    var input = document.getElementById('frHelpInput');
    document.getElementById('frHelpSend').onclick = submit;
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(90, input.scrollHeight) + 'px'; });

    renderChips();
    if (!document.getElementById('frHelpMsgs').childNodes.length) {
      addMsg('bot', "Hi! I'm the **RoofMap help assistant**. Ask me anything about mapping a roof, building a Job Pack, sending a quote, or ordering — or tap a suggestion below.");
    }
  }

  function renderChips() {
    var host = document.getElementById('frHelpChips'); if (!host) return;
    host.innerHTML = CHIPS.map(function (c) {
      return '<button class="fr-help-chip" style="background:#eef7fc;border:1px solid #cfe8f5;color:#036;border-radius:14px;padding:5px 10px;font-size:11.5px;cursor:pointer;font-family:inherit;line-height:1.2">' + esc(c) + '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.fr-help-chip'), function (b) {
      b.onclick = function () { ask(b.textContent); };
    });
  }

  function addMsg(who, html, isRaw) {
    var host = document.getElementById('frHelpMsgs'); if (!host) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;margin-bottom:10px;' + (who === 'user' ? 'justify-content:flex-end' : 'justify-content:flex-start');
    var bub = document.createElement('div');
    bub.style.cssText = 'max-width:85%;padding:9px 12px;border-radius:13px;font-size:13.5px;line-height:1.5;' +
      (who === 'user'
        ? 'background:#0099cc;color:#fff;border-bottom-right-radius:4px'
        : 'background:#fff;color:#0a1628;border:1px solid #e6ebf1;border-bottom-left-radius:4px');
    bub.innerHTML = isRaw ? html : (who === 'user' ? esc(html) : fmt(html));
    wrap.appendChild(bub); host.appendChild(wrap);
    host.scrollTop = host.scrollHeight;
    return bub;
  }

  function submit() {
    var input = document.getElementById('frHelpInput');
    var v = (input.value || '').trim();
    if (!v) return;
    input.value = ''; input.style.height = 'auto';
    ask(v);
  }

  function ask(text) {
    addMsg('user', text);
    var res = search(text);
    // brief "typing" delay for a natural feel
    var typing = addMsg('bot', '<span style="color:#94a3b8">…</span>', true);
    setTimeout(function () {
      if (typing && typing.parentNode) typing.parentNode.remove();
      if (res.best) {
        addMsg('bot', res.best.a);
        if (res.alts.length) {
          var rel = addMsg('bot', '<div style="font-size:11px;color:#64748b;margin-bottom:5px">Related:</div>' +
            res.alts.map(function (e) { return '<button class="fr-help-rel" data-q="' + esc(e.q[0]) + '" style="display:block;text-align:left;width:100%;background:#f1f6fb;border:1px solid #dce8f2;color:#036;border-radius:9px;padding:6px 9px;font-size:12px;cursor:pointer;margin:3px 0;font-family:inherit">' + esc(e.q[0].charAt(0).toUpperCase() + e.q[0].slice(1)) + '</button>'; }).join(''), true);
          Array.prototype.forEach.call(rel.querySelectorAll('.fr-help-rel'), function (b) { b.onclick = function () { ask(b.getAttribute('data-q')); }; });
        }
      } else {
        addMsg('bot', "I'm not certain I have an answer for that one. Try rephrasing, or tap a suggestion below.\n\nFor anything I can't cover, contact the office — **office@floodroofing.co.nz** or **0800 4 FLOOD**.");
      }
    }, 260);
  }

  function toggle(show) {
    openState = show;
    var p = document.getElementById('frHelpPanel'), l = document.getElementById('frHelpLauncher');
    if (p) p.style.display = show ? 'flex' : 'none';
    if (l) l.style.display = show ? 'none' : 'flex';
    if (show) { var i = document.getElementById('frHelpInput'); if (i) setTimeout(function () { i.focus(); }, 60); }
  }

  function init() {
    // Office app only — never on the shared customer proposal view.
    if (window.__CUSTOMER_MODE) return;
    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose a manual open hook (e.g. from a menu) if ever needed.
  window.openHelpBot = function () { build(); toggle(true); };
})();
