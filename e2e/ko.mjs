// Drive a fight to a KO through window.killsaws and grab the shot, the replay, and the card.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [url, outDir = 'docs/clips'] = process.argv.slice(2);
if (!url) { console.error('usage: node e2e/ko.mjs <url> [outDir]'); process.exit(1); }
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.killsaws?.begin, null, { timeout: 20000 });
await page.evaluate(async () => {
  const k = window.killsaws;
  const red = k.roster.find((b) => b.id === 'tombstone');
  const blue = k.roster.find((b) => b.id === 'minotaur');
  await k.begin({
    designs: [red, blue],
    seats: [{ kind: 'ai', ai: 'champion' }, { kind: 'ai', ai: 'champion' }],
    from: 'exhibition',
  });
});
await page.keyboard.press('Enter');
await page.evaluate(() => {
  const k = window.killsaws;
  k.setScreen('fight');
  k.session.hold = false;
});
await page.evaluate(() => {
  const s = window.killsaws.session;
  s.paused = true;
  s.fastForward(4);
  const m = s.match;
  const victim = m.bots[1];
  victim.internals.electronics = 0;
  victim.internals.driveL = 0;
  victim.internals.driveR = 0;
  victim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  victim.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const a = m.bots[0];
  a.body.setTranslation({ x: -2.4, y: a.pos.y, z: -0.6 }, true);
  victim.body.setTranslation({ x: 2.4, y: victim.pos.y, z: 0.6 }, true);
  a.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  s.fastForward(18, true);
  s.paused = true;
});
const moment = await page.evaluate(() => window.killsaws.session.moment);
if (moment !== 'ko') throw new Error('expected a KO, got ' + moment);
// Headless Chromium does not tick requestAnimationFrame, so the test pumps the broadcast.
await page.evaluate((n) => { for (let i = 0; i < n; i++) window.killsaws.session.pump(1 / 60); }, 70);
const shot = { animations: 'disabled', timeout: 180000 };
await page.screenshot({ path: `${outDir}/ko.png`, ...shot });
let mid = 'ko';
for (let i = 0; i < 16 && mid === 'ko'; i++) {
  mid = await page.evaluate((n) => {
    for (let k = 0; k < n; k++) window.killsaws.session.pump(1 / 30);
    return window.killsaws.session.moment;
  }, 12);
}
if (mid !== 'replay') throw new Error('expected a replay, got ' + mid);
await page.evaluate((n) => { for (let i = 0; i < n; i++) window.killsaws.session.pump(1 / 60); }, 45);
await page.screenshot({ path: `${outDir}/replay.png`, ...shot });
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.evaluate((n) => { for (let i = 0; i < n; i++) window.killsaws.session.pump(1 / 60); }, 8);
await page.waitForSelector('.results', { timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/results.png`, animations: 'disabled', timeout: 90000 });
const st = await page.evaluate(() => {
  const m = window.killsaws.session.match;
  return { phase: m.phase, method: m.result?.method, winner: m.bots[m.result.winner].design.name, moment: window.killsaws.session.moment };
});
console.log(JSON.stringify(st));
console.log(errors.join('\n') || 'no console errors');
await browser.close();
if (errors.length || st.method !== 'KO') process.exit(1);
