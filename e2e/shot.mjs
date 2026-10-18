// usage: node e2e/shot.mjs <url> <out.png> [waitMs] [js-to-run-after-load]
import { chromium } from 'playwright';
const [url, out, wait = '6000', js] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
if (js) { await page.evaluate(js); await page.waitForTimeout(Number(wait)); }
await page.screenshot({ path: out });
console.log(errors.slice(0, 20).join('\n') || 'no console errors');
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log('fps (swiftshader)', fps);
await browser.close();
