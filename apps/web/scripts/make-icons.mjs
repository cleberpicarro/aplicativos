// Gera os ícones PNG do PWA a partir de public/icon.svg, desenhando no Chromium (Playwright).
// Uso: node scripts/make-icons.mjs   (precisa do Playwright instalado globalmente ou no projeto)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)); }

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const [size, pad, file] of [[192, 0.14, 'icon-192.png'], [512, 0.14, 'icon-512.png'], [512, 0.24, 'icon-maskable.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;background:#fff;display:grid;place-items:center">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  writeFileSync(new URL(`../public/${file}`, import.meta.url), await page.screenshot({ type: 'png' }));
  await page.close();
}
await browser.close();
console.log('ícones gerados');
