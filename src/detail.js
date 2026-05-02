// src/detail.js — show/hide the detail panel + populate fields and OSM iframe.

const elPanel    = () => document.getElementById('detail');
const elLocation = () => document.getElementById('detail-location');
const elMag      = () => document.getElementById('detail-magnitude');
const elDepth    = () => document.getElementById('detail-depth');
const elMap      = () => document.getElementById('detail-map');

function osmEmbedUrl(lat, lng) {
    const d = 4; // bbox half-height in degrees (~regional view)
    const bbox = [lng - d * 2, lat - d, lng + d * 2, lat + d].join(',');
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

// Format a Smithsonian "Last_Eruption_Year" integer for display:
// negative years are BCE; "Holocene" if null.
function formatLastEruption(yr) {
    if (yr === null || yr === undefined) return 'Holocene';
    if (yr < 0) return `${Math.abs(yr)} BCE`;
    return String(yr);
}

export function showDetail(data) {
    if (data._kind === 'volcano') {
        // Volcano-specific fields (Smithsonian GVP)
        elLocation().textContent = data.name;
        const sub = [data.subregion, data.country].filter(Boolean).join(' · ');
        elMag().innerHTML  = '<h1>Type</h1>' + (data.type || '—');
        const elev = data.elevation_m == null ? '—' : `${data.elevation_m} m`;
        elDepth().innerHTML = `<h1>Last Eruption</h1>${formatLastEruption(data.last_eruption)}` +
                              `<div style="margin-top:6px;font-size:11px;opacity:0.7">${sub}</div>` +
                              `<div style="font-size:11px;opacity:0.7">Elevation ${elev}</div>`;
        elMap().src = osmEmbedUrl(data.lat, data.lng);
        elPanel().classList.add('show');
        return;
    }

    // Earthquake (existing path)
    elLocation().textContent = data.title;
    elMag().innerHTML        = '<h1>Magnitude</h1>' + data.magnitude;
    elDepth().innerHTML      = '<h1>Depth</h1>' + Math.round(data.depth * 0.621371) + ' miles';
    elMap().src              = osmEmbedUrl(data.lat, data.lng);
    elPanel().classList.add('show');
}

export function hideDetail() {
    elPanel().classList.remove('show');
}
