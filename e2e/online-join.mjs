// Two browsers, the failures that used to lose a join:
//  A) the guest joins and picks a bot BEFORE the host has opened the room;
//  B) the guest's network drops mid-lobby and must recover on its own;
// then the host starts and the guest must see the fight.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5180';
const out = process.argv[3] ?? 'online-join.png';
const code = 'T' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
const mk = async (tag) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(90000);
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  return { ctx, p };
};
const step = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const fail = async (s) => {
  console.log('FAIL', s); process.exitCode = 1;
  for (const [tag, x] of [['host', host], ['guest', guest]]) if (x) {
    await x.p.screenshot({ path: out.replace('.png', `-fail-${tag}.png`) }).catch(() => {});
    console.log(tag, 'says:', (await x.p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
  }
};
let host = null, guest = null;

// A) guest first
guest = await mk('guest');
await guest.p.goto(`${url}/?join=${code}`);
await guest.p.waitForSelector('input[placeholder="Your name"], input[maxlength="16"]');
await guest.p.locator('input[maxlength="16"]').fill('Colton');
await guest.p.click('button:has-text("Join")');
await guest.p.locator('.card', { hasText: 'Minotaur' }).first().click();
await guest.p.waitForSelector('text=/Waiting for the host/');
step(`guest in room ${code} with Minotaur picked; host not there yet`);

host = await mk('host');
await host.p.goto(`${url}/?host=${code}`);
try {
  await host.p.waitForSelector('text=/picked .*Minotaur/', { timeout: 240000 });
  step('A ok: host sees the pick the guest made before the room existed');
} catch { await fail('A: host never saw the guest pick'); }

// B) guest network drops mid-lobby
await guest.ctx.setOffline(true);
step('guest offline');
try {
  await host.p.waitForSelector('text=/reconnecting/', { timeout: 30000 });
  step('host shows the guest as reconnecting; FIGHT disabled: ' + await host.p.locator('button:has-text("FIGHT!")').isDisabled());
} catch { await fail('B: host never noticed the guest dropped'); }
await guest.ctx.setOffline(false);
step('guest back online');
try {
  await host.p.waitForFunction(() => !document.body.innerText.includes('reconnecting') && /picked .*Minotaur/.test(document.body.innerText), null, { timeout: 45000 });
  step('B ok: guest rejoined on its own, pick intact');
} catch { await fail('B: guest did not recover'); }

// start
await host.p.click('button:has-text("FIGHT!")');
await host.p.waitForTimeout(1500);
await host.p.keyboard.press('Enter');
try {
  await guest.p.waitForSelector('.nameplate', { timeout: 45000 });
  const names = await guest.p.locator('.nameplate .n').allTextContents();
  step('guest sees the fight: ' + names.join(' vs '));
} catch { await fail('guest never saw the fight'); }
await guest.p.waitForTimeout(3000);
await guest.p.screenshot({ path: out });
if (errs.length) console.log('ERRORS\n' + errs.join('\n'));
await browser.close();
