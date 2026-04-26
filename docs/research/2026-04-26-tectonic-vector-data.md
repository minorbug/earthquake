# Earthquake / Tectonic Visualization: Vector Data Research

A working document on free, openly-licensed vector datasets and metrics worth layering onto a three.js globe of recent seismicity.

---

## 1. Datasets

### 1.1 Plate Boundaries

#### PB2002 (Peter Bird, 2003)
- **What**: The canonical global plate-boundary model. 52 plates with classified boundary segments (divergent, convergent, transform, subduction, etc.). The reference dataset for tectonic visualization.
- **Source**: Original at `http://peterbird.name/oldFTP/PB2002/` (text + ArcGIS files). Pre-converted GeoJSON mirrored at `https://github.com/fraxen/tectonicplates` (Hugo Ahlenius) — `GeoJSON/PB2002_boundaries.json`, `PB2002_plates.json`, `PB2002_orogens.json`, `PB2002_steps.json`.
- **Format**: GeoJSON (mirror), Shapefile/text (original).
- **Size**: ~1–2 MB total for all four GeoJSON files. Static — geology doesn't move on web-app timescales.
- **License**: Original PB2002 is public-domain-equivalent (Bird requested citation: *Bird (2003), Geochem. Geophys. Geosyst., 4(3), 1027*). Ahlenius mirror is CC-BY-SA 3.0.
- **Hotlink**: Yes — GitHub raw / jsDelivr. Recommend hosting your own copy anyway (~100 KB gzipped).

#### GEM Global Active Faults — boundary subset
- See §1.3; GEM also publishes a plate-boundary subset but PB2002 is the more standard choice.

---

### 1.2 Plate Motion / Crustal Velocities

#### MORVEL / NNR-MORVEL56 (DeMets, Gordon, Argus, 2010)
- **What**: A rigid-plate angular-velocity model. Gives Euler poles for 56 plates; you compute surface velocity at any (lat, lon) by cross-product with the plate's pole. Yields a smooth global velocity field.
- **Source**: Pole tables at `http://geoscience.wisc.edu/~chuck/MORVEL/` (Chuck DeMets' page); also distributed as plain-text tables in the supplementary material of *DeMets et al. (2010), GJI 181, 1–80*.
- **Format**: Tab/space-delimited text, ~3 KB. You generate vectors yourself on whatever grid you like.
- **Size**: Trivial.
- **License**: Free for academic / non-commercial use with citation; widely redistributed.
- **Hotlink**: N/A — bake into the codebase.

#### UNAVCO / EarthScope GAGE GPS Velocity Fields
- **What**: Observed station velocities (mm/yr horizontal + vertical) from continuous GPS. Real measurements, not modeled — captures intra-plate deformation that MORVEL misses (e.g. Basin and Range, plate boundary zones).
- **Source**: `https://www.unavco.org/data/gps-gnss/derived-products/derived-products.html` and the GAGE Plate Motion Calculator at `https://www.unavco.org/software/geodetic-utilities/plate-motion-calculator/`. Bulk station velocities: `https://data.unavco.org/archive/gnss/products/velocity/`.
- **Format**: ASCII tables (.vel files), per-station rows.
- **Size**: Few MB for global station list (~20,000 stations). Updated periodically.
- **License**: Free, attribution to NSF GAGE / EarthScope Consortium. CC-BY-equivalent.
- **Hotlink**: Host your own. Pre-decimate to a regular grid for rendering.

#### Kreemer et al. 2014 — Global Strain Rate Model (GSRM v2.1)
- **What**: A continuous global horizontal velocity / strain-rate field on a 0.25° grid, derived from ~22,500 GPS stations. Beautiful: shows the smooth flow of the lithosphere including diffuse plate-boundary zones.
- **Source**: `http://gsrm2.unavco.org/` (Global Strain Rate Map project).
- **Format**: ASCII grid.
- **Size**: ~10–20 MB raw; decimates well.
- **License**: Free, cite *Kreemer, Blewitt, Klein (2014), G-cubed*.
- **Hotlink**: Host your own; decimate to ~2° for rendering (~5,000 vectors).

---

### 1.3 Active Faults

#### GEM Global Active Faults Database (GEM-GAF)
- **What**: ~13,500 active fault traces worldwide, attributed with slip type (normal / reverse / strike-slip), slip rate, dip, and confidence. The most complete free global fault dataset.
- **Source**: `https://github.com/GEMScienceTools/gem-global-active-faults` — `gmt/gem_active_faults.geojson`. Project page: `https://blogs.openquake.org/hazard/global-active-faults/`.
- **Format**: GeoJSON natively.
- **Size**: ~15 MB raw GeoJSON; ~3–5 MB gzipped. Updated ~yearly.
- **License**: CC-BY-SA 4.0. Attribution: *GEM Foundation, Global Active Faults Database*.
- **Hotlink**: GitHub raw works but slow; jsDelivr CDN serves it. Host your own simplified version.

#### USGS Quaternary Faults and Folds (US only)
- **What**: Detailed fault traces in the US, including last-rupture age. Higher resolution than GEM-GAF over its footprint.
- **Source**: `https://www.usgs.gov/programs/earthquake-hazards/faults` — Quaternary Fault and Fold Database; also has a Web Map Service. GeoJSON via the ScienceBase API: `https://www.sciencebase.gov/catalog/item/5a6a50bce4b06e28e9bfc18c`.
- **Format**: Shapefile, KML, GeoJSON via ArcGIS REST.
- **Size**: ~10 MB.
- **License**: Public domain (US Government).
- **Hotlink**: USGS ArcGIS endpoints are reasonably stable; host your own for production.

---

### 1.4 Earthquake Catalogs (Beyond the M4.5 Feed)

#### USGS ComCat (Comprehensive Catalog)
- **What**: The full USGS catalog with phases, focal mechanisms (moment tensors), shakemaps, aftershock products, etc. The current viz uses only a small slice.
- **Source**: `https://earthquake.usgs.gov/fdsnws/event/1/` (FDSN event web service) — `query?format=geojson&...`. Real-time GeoJSON feeds at `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/` (you're already using these).
- **Format**: GeoJSON, QuakeML.
- **Size**: Variable. Last 30 days of M4.5+ is ~hundreds of KB. M2.5+ feed is ~MBs.
- **License**: Public domain.
- **Hotlink**: Yes, USGS allows it. Cache aggressively.
- **Hidden gem**: each event detail has a `products.moment-tensor` field with focal-mechanism solutions — the data needed for beach-ball symbols. Fetch lazily on click.

#### ISC-GEM Global Instrumental Catalog
- **What**: Reviewed catalog of M5.5+ events 1900–present, with consistent magnitudes and locations. Better for historical Mw 8+ display than ComCat (which is sparse pre-1970s).
- **Source**: `http://www.isc.ac.uk/iscgem/download.php`.
- **Format**: CSV.
- **Size**: ~5 MB; updated annually.
- **License**: CC-BY 4.0. Cite *Storchak et al. (2013, 2015)*.

---

### 1.5 Slab Geometry

#### Slab2 (Hayes et al., USGS, 2018)
- **What**: 3D geometry of all major subducted slabs worldwide — depth, dip, strike, thickness as gridded surfaces. This is the dataset for showing "where the plate dives." Genuinely 3D, not just surface contours.
- **Source**: `https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467`. Per-slab `.grd` (NetCDF) files plus contour GeoJSON.
- **Format**: NetCDF rasters + Shapefile/GeoJSON contours. Contours are the easy path.
- **Size**: Full raster set ~100 MB. Contour-only GeoJSON is ~5–10 MB total across all slabs.
- **License**: Public domain (USGS).
- **Hotlink**: Host your own — files are on ScienceBase, not CDN-friendly.

---

### 1.6 Volcanoes

#### Smithsonian Global Volcanism Program (GVP)
- **What**: All Holocene volcanoes (~1,400) and current eruptions. Strongly co-located with subduction-zone seismicity — visually reinforces the Ring of Fire.
- **Source**: `https://volcano.si.edu/database/webservices.cfm` (WFS / GeoJSON). Bulk download: `https://volcano.si.edu/list_volcano_holocene.cfm`.
- **Format**: GeoJSON, KML, CSV.
- **Size**: <1 MB for the volcano list.
- **License**: Free with attribution: *Global Volcanism Program, Smithsonian Institution*.
- **Hotlink**: Their WFS works but is slow; cache locally.

---

### 1.7 Bonus: Tsunami Events & Historical Significant Events

#### NOAA NCEI Global Historical Tsunami / Significant Earthquake Database
- **What**: ~6,000 tsunami events and ~6,000 "significant earthquakes" (deadly, damaging, or M7.5+) from 2150 BC to present.
- **Source**: `https://www.ngdc.noaa.gov/hazard/tsu_db.shtml` and `https://www.ngdc.noaa.gov/hazard/earthqk.shtml`. Direct GeoJSON via ArcGIS endpoints: `https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/`.
- **Format**: JSON / GeoJSON / TSV.
- **Size**: <2 MB.
- **License**: US Government public domain.
- **Hotlink**: API works.

---

## 2. Metrics Ranked by Visual Punch

Scored 1–5. Net = Visual + Insight − Cost.

| # | Metric | Visual | Insight | Cost | Net | Notes |
|---|---|---|---|---|---|---|
| 1 | **Plate boundary network (PB2002), styled by type** | 5 | 5 | 1 | **9** | Tiny dataset, transformative impact. Color: red divergent, blue convergent, yellow transform. The single highest-leverage addition. |
| 2 | **Slab2 depth contours / surfaces** | 5 | 5 | 3 | **7** | Visually unique — shows quakes are *on* a tilted plane diving into the mantle. Best at subduction zones (Japan, Andes, Cascadia). Translucent ribbons inside the globe. |
| 3 | **MORVEL plate motion arrows on a lat/lon grid** | 4 | 5 | 2 | **7** | Tiny data; you compute the field. The "why" behind boundary types becomes visible — divergent boundaries pull apart, convergent boundaries close. |
| 4 | **Focal mechanisms (beach balls) on click** | 5 | 4 | 3 | **6** | Iconic seismologist symbol. Lazy-load per event from ComCat. Reveals fault orientation, not just location. Only ~30% of M4.5+ events have published moment tensors. |
| 5 | **GEM Global Active Faults** | 4 | 4 | 2 | **6** | Lots of lines. Color by slip type. Visually busy; fade by zoom or cluster by region. |
| 6 | **Smithsonian Holocene volcanoes** | 3 | 4 | 1 | **6** | Cheap and reinforcing — volcanoes trace the Ring of Fire alongside quakes. |
| 7 | **Historical Mw 8+ markers (ISC-GEM)** | 4 | 4 | 2 | **6** | A handful of dots per century with huge cultural weight: 1960 Chile, 1964 Alaska, 2004 Sumatra, 2011 Tohoku. Pulsing memorial markers. |
| 8 | **GSRM strain-rate heatmap** | 5 | 4 | 4 | **5** | Continuous color field showing where the crust deforms. Beautiful but expensive — ~10 MB and requires a texture/shader. |
| 9 | **Tsunamigenic event highlighting** | 3 | 4 | 2 | **5** | Tag events from NOAA db with a tsunami badge. Cheap if you join on USGS ID. |
| 10 | **Aftershock halos (Omori decay)** | 3 | 4 | 3 | **4** | Group events to nearest M6+ within 7 days and 100 km; render as fading halo. Conceptual payoff is high but reads as clutter without restraint. |
| 11 | **Gutenberg–Richter b-value heatmap** | 2 | 4 | 4 | **2** | Researchers love it; visually muted. Skip unless you build a separate "stats" mode. |
| 12 | **Seismic gap highlighting** | 3 | 5 | 5 | **3** | Genuinely interesting (regions overdue) but requires custom analysis — no off-the-shelf gap polygon dataset exists. Defer. |
| 13 | **Cross-section ribbons through subduction zones** | 5 | 5 | 5 | **5** | Wadati–Benioff zone visualization. Striking but needs UI: a draggable cross-section line. Big project. |
| 14 | **Cascadia slow-slip / tremor episodes** | 3 | 4 | 4 | **3** | PNSN publishes tremor catalogs. Niche regional payoff. |

**Top 4 recommendation: PB2002, Slab2 contours, MORVEL arrows, focal-mechanism beach balls on click.** These collectively answer "where, why, how" for almost every quake on the globe, fit in <10 MB total, and don't fight each other visually.

---

## 3. Recommended Visual Pairing

Given the existing viz (textured globe, animated quake markers, depth-encoded color), here's a layered composition that builds rather than competes.

### Foreground (the existing layer — keep)
Animated quake blobs with pulse rings. Magnitude → size, depth → color. This is your hero layer. Everything else should sit *under* it.

### Mid-ground: Plate Boundaries (PB2002)
Thin lines, slightly raised off the surface (~1.005 R) so quakes don't z-fight. **Style by boundary type:**
- Divergent (mid-ocean ridges): warm orange-red, faint glow — these are where new crust is born.
- Convergent (subduction): cool teal, slightly thicker — quakes will visibly cluster on these.
- Transform: muted yellow dashed.

This single layer turns "dots on Earth" into "dots on the *fault network of Earth*." It's the highest-impact addition and the cheapest.

### Atmosphere: Plate Motion Field (MORVEL)
Sparse grid (every ~10°, skipping land/ocean if you want to differentiate) of small arrowheads — color and length by speed (mm/yr). Render at very low alpha (~25%). Goal: when you stop the camera, you sense the slow ballet of plates; when you spin, the arrows blur into ambient motion. **Do not** make these prominent — they're the wallpaper, not the subject.

### Underground: Slab2 contour ribbons
This is the wild card. Render slab depth contours (50, 100, 200, 400 km) as translucent surfaces *inside* the globe sphere, visible through a semi-transparent Earth or via a clipping plane. When the camera is over Japan, you see the Pacific plate diving under as a ghostly ramp; quake markers visibly trace its upper surface.

If full 3D ribbons are too much, fall back to projected contour *lines* on the surface — still informative.

### Replacement of `world.jpg`
Drop the photo texture entirely. Use:
- A subtle bathymetry gradient (Natural Earth bathymetry GeoTIFF, baked into a low-res texture or rendered as continent-fill from a Natural Earth `ne_50m_land` GeoJSON — ~500 KB).
- Continent outlines as thin lines (Natural Earth `ne_110m_coastline` is ~50 KB GeoJSON).

That gives you a "map of Earth, not photo of Earth" aesthetic that lets the tectonic data breathe. The current photographic globe makes everything else look glued on.

### On click (existing detail panel)
Add: focal-mechanism beach ball (from ComCat moment-tensor product), nearest mapped fault (from GEM-GAF), distance to nearest plate boundary, plate name (from PB2002 plates polygon). Plus tsunami flag if NOAA has a record.

---

## 4. Reality Checks

### Heavy datasets — strategies
| Dataset | Raw size | Strategy |
|---|---|---|
| GEM-GAF | ~15 MB | Pre-simplify with `mapshaper` (`-simplify 10%`) → ~3 MB. Or split by region and lazy-load. |
| Slab2 rasters | ~100 MB | Use the contour GeoJSONs only; ignore the full grids. ~5 MB. |
| GSRM grid | ~10–20 MB | Decimate to 2°, ship as binary Float32 array (~50 KB). Or pre-render to a small equirectangular texture. |
| UNAVCO station velocities | several MB | Subset to a regional grid; or use MORVEL (rigid model) globally and add real GPS only for plate-boundary zones. |
| ISC-GEM | ~5 MB CSV | Filter to M7.5+ at build time → <100 KB. |

**Rule of thumb for browser-side three.js:** target <2 MB gzipped for the full vector layer set. PB2002 + MORVEL + Slab2 contours + Natural Earth coast + ISC-GEM-filtered + Smithsonian volcanoes is comfortably under that.

### Attribution
- **GEM-GAF**: CC-BY-SA 4.0. The ShareAlike clause is meaningful — derivatives must use the same license. Display *"Faults: GEM Foundation (CC-BY-SA 4.0)"* in your credits.
- **Ahlenius PB2002 mirror**: CC-BY-SA 3.0 — same concern. You can avoid it by using the original PB2002 text files directly (public-domain-equivalent).
- **GSRM**: requires citing Kreemer et al. 2014.
- **MORVEL**: cite DeMets et al. 2010.
- **Slab2, USGS catalogs, USGS Q-faults**: US Government public domain — credit is courteous, not required.
- **Smithsonian GVP**: required attribution, no license restriction.
- **NOAA NCEI**: public domain.

A single "Data sources" credits panel is enough — none of these require per-frame on-globe text.

### Surprises / underused metrics worth knowing
1. **Slab2 is the single most underused dataset in public earthquake viz.** Almost every web globe shows points on a sphere and ignores that the points actually trace the *3D shape of subducted plates*. Even a partial implementation would distinguish this project.
2. **ComCat moment-tensor "products" are addressable per event** — `https://earthquake.usgs.gov/earthquakes/eventpage/{id}/moment-tensor` returns structured strike/dip/rake. Most viz projects show only location and magnitude; beach-ball orientation per event is rare and high-value.
3. **GSRM strain rate is more honest than rigid plate motion.** Rigid models say "California is moving 50 mm/yr northwest" but reality is a smear of deformation across a 200-km-wide zone. A strain-rate layer captures that the San Andreas system is a *region*, not a line.
4. **Tsunami flagging via NOAA is nearly free** (small DB, joinable on USGS ID for modern events) and adds a powerful "consequences" dimension to historical Mw 8+ markers.
5. **Co-rendering Holocene volcanoes** with quakes makes the Ring of Fire visually self-evident in a way neither layer does alone — and the volcano dataset is <1 MB. High leverage, often forgotten.
6. **Slow-slip and tectonic tremor catalogs** (Cascadia, Japan, Mexico) reveal "earthquakes" that take weeks instead of seconds — not visualized in any consumer-facing globe I'm aware of. PNSN publishes Cascadia tremor episodes; rendering a few hundred tremor pulses along the Cascadia margin would be unique.

---

## TL;DR Recommended starter pack

1. **PB2002 boundaries** — Ahlenius GeoJSON or original Bird files. ~200 KB. Style by boundary type.
2. **Natural Earth coastline / land** at 110m. ~50 KB. Replaces `world.jpg`.
3. **MORVEL Euler poles** — compute a 36×18 arrow grid in JS from a 3 KB pole table.
4. **Slab2 contour GeoJSON** — depth-banded ribbons under the globe. ~5 MB simplified.
5. **Smithsonian Holocene volcanoes** — small dots, co-located with quakes. <1 MB.
6. **ComCat moment tensors on click** — lazy-load per event. Shows fault mechanism.
7. **ISC-GEM filtered to Mw 8+** — historical context, <100 KB after filtering.
8. **Stretch: GSRM strain rate** as a low-alpha texture under everything.

Total cost: <10 MB transferred, all CC-BY / public-domain compatible, all hotlink-tolerant if cached on your origin.
