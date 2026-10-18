// Click through: Exhibition -> FIGHT -> skip intro -> screenshot mid-fight with both AI driving.
import { chromium } from 'playwright';
const [url, out, red = 'tombstone', blue = 'minotaur', secs = '14'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url);
await page.waitForTimeout(2500);
await page.click('text=Exhibition');
await page.waitForTimeout(500);
const corners = page.locator('.corner');
await corners.nth(0).locator('select').selectOption('aichampion');
await corners.nth(1).locator('select').selectOption('aichampion');
await corners.nth(0).locator('.card', { hasText: new RegExp('^' + red, 'i') }).first().click().catch(() => {});
await page.click('text=FIGHT!');
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
// swiftshader is slow; drive the sim faster than real time from the test hook
await page.evaluate((s) => { const k = window.killsaws; const m = k.session.match; for (let i = 0; i < 240 * s; i++) { for (let j = 0; j < 2; j++) m.setInput(j, k.session.drivers?.[j]?.think?.(m, 1/240) ?? m.bots[j].input); m.step(); } }, Number(secs));
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
const st = await page.evaluate(() => { const m = window.killsaws.session.match; return { t: m.fightTime.toFixed(1), phase: m.phase, res: m.result, bots: m.bots.map((b) => ({ n: b.design.name, x: b.pos.x.toFixed(2), z: b.pos.z.toFixed(2), rpm: Math.round(Math.abs(b.spinner?.omega ?? 0) * 9.55) })) }; });
console.log(JSON.stringify(st));
console.log(errors.join('\n') || 'no console errors');
await browser.close();
