import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
for (const n of ["forma","vibex","cloud","tile"]) {
  await p.setContent(`<body style="margin:0;background:transparent">${readFileSync(n + ".svg", "utf8")}</body>`);
  await p.screenshot({ path: `${out}/${n}.png`, omitBackground: true });
}
await b.close();
