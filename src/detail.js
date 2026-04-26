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

export function showDetail(data) {
    elLocation().textContent = data.title;
    elMag().innerHTML        = '<h1>Magnitude</h1>' + data.magnitude;
    elDepth().innerHTML      = '<h1>Depth</h1>' + Math.round(data.depth * 0.621371) + ' miles';
    elMap().src              = osmEmbedUrl(data.lat, data.lng);
    elPanel().classList.add('show');
}

export function hideDetail() {
    elPanel().classList.remove('show');
}
