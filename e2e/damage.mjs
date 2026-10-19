// Battle damage proof: fast-forward a real AI fight through window.killsaws,
// feeding every sim event to the renderer, then photograph both robots up close
// (gallery camera) and from the broadcast camera.
// usage: node e2e/damage.mjs <url> <outdir> <red> <blue> <seconds> [seed] [js-after]
import { chromium } from 'playwright';

const [url, out, red = 'tombstone', blue = 'minotaur', secs = '90', seed = '3', after = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(2500);
await page.evaluate(() => { const l = document.querySelector('.layer'); if (l) l.style.display = 'none'; });

const summary = await page.evaluate(async ([red, blue, secs, seed, after]) => {
  const k = window.killsaws;
  const A = k.roster.find((b) => b.id === red), B = k.roster.find((b) => b.id === blue);
  await k.session.start([A, B], [{ kind: 'ai', ai: 'champion' }, { kind: 'ai', ai: 'champion' }], { seed: Number(seed), matchSeconds: 180 });
  k.session.hold = true; // we drive the sim from here, faster than real time
  const m = k.session.match;
  const drivers = k.session.drivers;
  const steps = Math.round((3 + Number(secs)) * 240);
  for (let i = 0; i < steps && !m.result; i++) {
    for (let j = 0; j < 2; j++) m.setInput(j, drivers[j].think(m, 1 / 240));
    m.step();
    const ev = m.drainEvents();
    if (ev.length || i % 24 === 0) {
      k.view.apply(m.view(), { slide: m.bots.map((b) => b.slidePos), secondary: m.bots.map((b) => b.secondaryAct?.pos ?? 0) });
      k.view.events(ev);
    }
    if (i % 60 === 0) k.view.frame(0.25, m.bots.map((b) => b.flameOn));
  }
  if (after) eval(after);
  k.view.apply(m.view());
  for (let i = 0; i < 6; i++) k.view.frame(0.25);
  const v = m.view();
  return {
    t: m.fightTime.toFixed(1), result: m.result,
    bots: v.bots.map((b, i) => ({ name: m.bots[i].design.name, panels: b.panels, internals: b.internals, fire: b.onFire, marks: k.view.damage[i]?.marks.length })),
  };
}, [red, blue, secs, seed, after]);
console.log(JSON.stringify(summary));

const shots = [];
for (const [tag, js] of [
  ['red', "k.view.focus = 0; k.view.setMode('gallery')"],
  ['blue', "k.view.focus = 1; k.view.setMode('gallery')"],
  ['broadcast', "k.view.setMode('broadcast')"],
]) {
  await page.evaluate((js) => { const k = window.killsaws; eval(js); }, js);
  await page.waitForTimeout(2500);
  const ms = await page.evaluate(() => new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t))); }));
  console.log(tag, 'two frames took', Math.round(ms), 'ms');
  const f = `${out}/${red}-${blue}-${tag}.png`;
  await page.screenshot({ path: f });
  shots.push(f);
}
console.log(shots.join('\n'));
if (errors.length) console.log('ERRORS', errors.join('\n'));
await browser.close();
