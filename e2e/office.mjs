// Design Office walk-through (#18): brief -> hidden-stat Garage -> spec sheet -> inspection
// (a weigh-in forfeit, then the revision) -> an AI-vs-AI fight on true physics -> results ->
// season card after a reload. Then brief 2's inspection with a miss and its cost line.
// usage: node e2e/office.mjs <url> [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [url, outDir = 'docs/office'] = process.argv.slice(2);
if (!url) { console.error('usage: node e2e/office.mjs <url> [outDir]'); process.exit(1); }
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const shot = async (name) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${name}.png`, animations: 'disabled', timeout: 180000 });
  console.log('shot', name);
};
const click = (text) => page.getByRole('button', { name: text, exact: false }).first().click();

await page.goto(url);
await page.waitForFunction(() => window.killsaws?.begin, null, { timeout: 30000 });
await page.evaluate(() => localStorage.removeItem('killsaws.office.v1'));
await click('Design Office');
await click('Open brief 1');
await shot('01-brief');

await click('Open the garage');
await page.waitForSelector('.office-aside');
await shot('02-garage-hidden');

// Spec sheet: claim 249 lb on a robot that is really over the limit.
await click('Spec sheet');
await page.getByRole('textbox').first().fill('249');
await shot('03-spec-entry');
await click('Submit for tech inspection');
await page.waitForSelector('.inspect');
await shot('04-inspection-forfeit');

// The one revision: thin the armor until the card's own sum says 240-250 lb, then do the card math.
await click('Fix the design');
await page.waitForSelector('.office-aside');
const cardLb = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.refcard section:first-of-type table.cardtbl tr td:last-child')];
  return rows.reduce((s, td) => s + parseFloat(td.textContent), 0) / 0.45359237;
});
await page.locator('.office-aside summary').click();
const armor = page.locator('input[title="thickness, mm"]');
let k = 0.75;
for (let i = 0; i < 8; i++) {
  for (let j = 1; j <= 5; j++) {
    const el = armor.nth(j);
    const v = parseFloat(await el.inputValue());
    await el.fill(String(Math.max(1, Math.round(v * k * 10) / 10)));
  }
  const lb = await cardLb();
  console.log('card weight', lb.toFixed(2));
  if (lb <= 249 && lb >= 241) break;
  k = lb > 249 ? 0.95 : 1.04;
}
await click('Spec sheet');
const claim = (await cardLb()).toFixed(1);
await page.getByRole('textbox').first().fill(claim);
await click('Submit for tech inspection');
await page.waitForSelector('.inspect');
await shot('05-inspection-revised');

// Fight: AI drives both. Skip the intro, run the whole fight on the sim, pump the finish.
await click('Fight: AI drives both');
await page.waitForFunction(() => window.killsaws.session.match, null, { timeout: 60000 });
await page.keyboard.press('Enter');
await page.evaluate(() => { const s = window.killsaws.session; s.fastForward(25); s.paused = true; });
await page.evaluate((n) => { for (let i = 0; i < n; i++) window.killsaws.session.pump(1 / 60); }, 20);
await shot('06-fight');
await page.evaluate(() => { const s = window.killsaws.session; s.paused = false; s.fastForward(200); s.paused = true; });
for (let i = 0; i < 40; i++) {
  const m = await page.evaluate((n) => { for (let k = 0; k < n; k++) window.killsaws.session.pump(1 / 30); return window.killsaws.session.moment; }, 15);
  if (m === 'replay') await page.keyboard.press('Enter');
  if (m === 'done') break;
}
await page.evaluate(() => { window.killsaws.session.paused = false; for (let i = 0; i < 10; i++) window.killsaws.session.pump(1 / 60); });
await page.waitForSelector('.results .office-notes', { timeout: 60000 });
await shot('07-results');
const res = await page.evaluate(() => { const m = window.killsaws.session.match; return { method: m.result?.method, winner: m.bots[m.result.winner].design.name, time: m.result?.time }; });
console.log('fight', JSON.stringify(res));
await click('Back to the Design Office');
await page.waitForSelector('table.season');

// Progress survives a reload.
await page.reload();
await page.waitForFunction(() => window.killsaws?.begin, null, { timeout: 30000 });
await click('Design Office');
await page.waitForSelector('table.season');
await shot('08-season-card');

// Brief 2: a wrong thickness reveals the true value and what it costs.
await click('Open brief 2');
await click('Open the garage');
await click('Spec sheet');
await page.getByRole('textbox').first().fill('9.5');
await click('Submit for tech inspection');
await page.waitForSelector('.inspect');
await shot('09-inspection-miss');

console.log(errors.slice(0, 20).join('\n') || 'no console errors');
await browser.close();
