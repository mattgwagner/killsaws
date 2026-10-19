// Battle damage close-ups: run a real AI fight through window.killsaws, feeding
// every sim event to the renderer, optionally push a bot's health down through
// the view (the renderer's only input) to stage a state the seeded fight did
// not reach, then photograph each robot from four sides with a free camera.
// usage: node e2e/damage.mjs <url> <outdir> <red> <blue> <seconds> [seed] [force-json]
//   force-json: {"1":{"panels":{"right":0},"internals":{"battery":0.3},"onFire":true}}
import { chromium } from 'playwright';

const [url, out, red = 'tombstone', blue = 'minotaur', secs = '90', seed = '3', force = '{}'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.killsaws?.roster?.length, null, { timeout: 300000 });
await page.evaluate(() => { const l = document.querySelector('.layer'); if (l) l.style.display = 'none'; });

const summary = await page.evaluate(async ([red, blue, secs, seed, force]) => {
  const k = window.killsaws;
  const A = k.roster.find((b) => b.id === red), B = k.roster.find((b) => b.id === blue);
  await k.session.start([A, B], [{ kind: 'ai', ai: 'champion' }, { kind: 'ai', ai: 'champion' }], { seed: Number(seed), matchSeconds: 180 });
  k.session.hold = true;
  const m = k.session.match, drivers = k.session.drivers;
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
  const f = JSON.parse(force);
  const real = m.view.bind(m);
  const staged = () => {
    const v = real();
    for (const [i, o] of Object.entries(f)) {
      const b = v.bots[Number(i)];
      Object.assign(b.panels, o.panels ?? {});
      Object.assign(b.internals, o.internals ?? {});
      if (o.onFire !== undefined) b.onFire = o.onFire;
      if (o.inverted !== undefined) b.inverted = o.inverted;
    }
    return v;
  };
  // the held game loop re-applies m.view() every frame: keep it showing the staged state
  m.view = staged;
  // a few seconds of frames so smoke and flaps settle in
  for (let i = 0; i < 45; i++) { k.view.apply(staged()); k.view.frame(1 / 15); }
  const v = staged();
  return {
    t: m.fightTime.toFixed(1), result: m.result,
    bots: v.bots.map((b, i) => ({ name: m.bots[i].design.name, panels: b.panels, internals: b.internals, fire: b.onFire, marks: k.view.damage[i]?.marks.length, state: k.view.damage[i]?.state })),
  };
}, [red, blue, secs, seed, force]);
console.log(JSON.stringify(summary));

const shots = [];
for (const bot of [0, 1]) {
  for (const [tag, az, el] of [['fl', 0.7, 0.5], ['rr', 3.9, 0.55], ['top', 0.2, 1.45], ['side', 2.2, 0.35]]) {
    await page.evaluate(([bot, az, el]) => {
      const k = window.killsaws, v = k.view;
      v.setMode('free');
      const r = v.bots[bot].root;
      const fwd = Math.atan2(-2 * (r.quaternion.w * r.quaternion.y + r.quaternion.x * r.quaternion.z), 1 - 2 * (r.quaternion.y ** 2 + r.quaternion.z ** 2));
      const reach = 1.6 * Math.max(0.6, v.designs[bot].chassis.length);
      const a = fwd + az;
      v.controls.target.copy(r.position);
      v.camera.position.set(r.position.x + Math.cos(a) * Math.cos(el) * reach, r.position.y + Math.sin(el) * reach, r.position.z - Math.sin(a) * Math.cos(el) * reach);
      v.camera.lookAt(r.position);
      v.frame(1 / 30);
    }, [bot, az, el]);
    await page.waitForTimeout(400);
    const file = `${out}/${red}-${blue}-${bot ? 'blue' : 'red'}-${tag}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
  }
}
await page.evaluate(() => { const v = window.killsaws.view; v.setMode('broadcast'); for (let i = 0; i < 8; i++) v.frame(1 / 15); });
await page.waitForTimeout(400);
const bc = `${out}/${red}-${blue}-broadcast.png`;
await page.screenshot({ path: bc });
shots.push(bc);
console.log(shots.join('\n'));
if (errors.length) console.log('ERRORS', errors.join('\n'));
await browser.close();
