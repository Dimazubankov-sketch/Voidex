// Renders the Clock widget's backdrop (lavender surface + ring + empty face; the hands and marks are live, drawn in widgets.tsx).
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
const out = process.argv[2];
const SIZES = { s: { w: 521, h: 514, x: 0.5167, y: 0.5163, r: 0.30 }, w: { w: 1028, h: 514, x: 0.727, y: 0.5212, r: 0.3424 } };
const svg = ({ w, h, x, y, r }) => {
  const cx = x * w, cy = y * h, ri = r * h, ro = ri * 1.3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}">
<defs>
 <linearGradient id="bg" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#fbf9ff"/><stop offset="0.55" stop-color="#efe8fd"/><stop offset="1" stop-color="#e2d6fa"/></linearGradient>
 <radialGradient id="b1" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#cdb6f5" stop-opacity="0.7"/><stop offset="1" stop-color="#cdb6f5" stop-opacity="0"/></radialGradient>
 <linearGradient id="ring" x1="0.15" y1="0.05" x2="0.85" y2="0.95"><stop offset="0" stop-color="#e1c4ff"/><stop offset="0.35" stop-color="#b57bff"/><stop offset="0.7" stop-color="#8a45ff"/><stop offset="1" stop-color="#6a2cff"/></linearGradient>
 <linearGradient id="face" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#f6f1ff"/><stop offset="1" stop-color="#ebe1fd"/></linearGradient>
 <filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="${ro * 0.12}" stdDeviation="${ro * 0.1}" flood-color="#6a35e0" flood-opacity="0.38"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<ellipse cx="${w * 0.78}" cy="${h * 0.12}" rx="${w * 0.34}" ry="${h * 0.5}" fill="url(#b1)"/>
<ellipse cx="${w * 0.18}" cy="${h * 0.98}" rx="${w * 0.42}" ry="${h * 0.42}" fill="url(#b1)" opacity="0.7"/>
<circle cx="${cx}" cy="${cy}" r="${ro}" fill="url(#ring)" filter="url(#sh)"/>
<circle cx="${cx}" cy="${cy}" r="${ro - 1.2}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="${ri}" fill="url(#face)"/>
<circle cx="${cx}" cy="${cy}" r="${ri}" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="1.5"/>
</svg>`;
};
const b = await chromium.launch(); const p = await b.newPage();
for (const [k, d] of Object.entries(SIZES)) {
  await p.setViewportSize({ width: d.w * 2, height: d.h * 2 });
  await p.setContent(`<body style="margin:0">${svg(d)}</body>`);
  await p.screenshot({ path: `${out}/widget-clock-${k}.png` });
}
await b.close();
