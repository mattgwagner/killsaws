// Close-up of every roster bot (intro camera) into a contact sheet folder.
import { chromium } from 'playwright';
const [url, dir, ids] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
await page.goto(url); await page.waitForTimeout(3000);
await page.evaluate(() => { document.querySelector('.layer').style.display = 'none'; });
const list = ids ? ids.split(',') : await page.evaluate(() => window.killsaws.roster.map((b) => b.id));
for (const id of list) {
  await page.evaluate(async (id) => {
    const k = window.killsaws; const d = k.roster.find((b) => b.id === id);
    await k.session.start([d, k.roster[0]], [{ kind: 'ai' }, { kind: 'ai' }], { seed: 1 });
    k.session.hold = true; k.view.focus = 0; k.view.setMode('gallery');
    const m = k.session.match; const b = m.bots[0];
    b.body.setTranslation({ x: 0, y: b.pos.y, z: 0 }, true);
    b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    m.bots[1].body.setTranslation({ x: 6, y: 0.3, z: 6 }, true);
  }, id);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/${id}.png` });
}
await browser.close();
