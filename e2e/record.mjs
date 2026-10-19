// Tombstone vs Minotaur, driven to a KO, with the finish recorded.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const [url, out = 'docs/clips/ko.webm'] = process.argv.slice(2);
if (!url) { console.error('usage: node e2e/record.mjs <url> [out.webm]'); process.exit(1); }
await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: dirname(out), size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
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
// Each evaluate returns so the page presents. No screenshots: those stall the video for minutes.
for (let i = 0; i < 70; i++) {
  const moment = await page.evaluate((n) => {
    for (let k = 0; k < n; k++) window.killsaws.session.pump(1 / 60);
    return window.killsaws.session.moment;
  }, 4);
  if (moment === 'done') break;
  if (moment === 'replay' && i > 46) {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
}
await page.waitForSelector('.results', { timeout: 20000 });
const video = page.video();
await context.close();
const raw = `${out}.raw.webm`;
await video.saveAs(raw);
await browser.close();
// Swiftshader presents slowly, so the capture is minutes of held frames. Keep the frames that changed.
execFileSync('ffmpeg', [
  '-y', '-sseof', '-75', '-i', raw,
  '-an', '-c:v', 'libvpx', '-b:v', '900k', '-deadline', 'good',
  out,
], { stdio: 'inherit' });
await unlink(raw);
for (const name of await readdir(dirname(out))) {
  if (name.startsWith('page@')) await unlink(`${dirname(out)}/${name}`);
}
console.log(out);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
