// Procedural textures (canvas) so the app ships with zero image assets.
import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The BattleBox floor: welded steel plates, seams, bolts, scuffs, tire marks. */
export function floorTextures(size = 2048, plates = 6) {
  const [c, g] = canvas(size, size);
  const [rc, rg] = canvas(size, size); // roughness
  const R = rand(7);
  g.fillStyle = '#5b5f63';
  g.fillRect(0, 0, size, size);
  rg.fillStyle = '#9a9a9a';
  rg.fillRect(0, 0, size, size);
  const p = size / plates;
  for (let i = 0; i < plates; i++) {
    for (let j = 0; j < plates; j++) {
      const shade = 58 + Math.floor(R() * 18);
      g.fillStyle = `rgb(${shade},${shade + 3},${shade + 6})`;
      g.fillRect(i * p + 3, j * p + 3, p - 6, p - 6);
      // mill scale blotches
      for (let k = 0; k < 40; k++) {
        const x = i * p + R() * p, y = j * p + R() * p, r = 10 + R() * 70;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const dark = R() < 0.5;
        gr.addColorStop(0, dark ? 'rgba(20,20,22,0.25)' : 'rgba(130,130,135,0.06)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // bolts at plate corners
      for (const [bx, by] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94], [0.5, 0.06], [0.5, 0.94], [0.06, 0.5], [0.94, 0.5]]) {
        const x = i * p + bx * p, y = j * p + by * p;
        g.fillStyle = '#2b2d30';
        g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#8d9196';
        g.beginPath(); g.arc(x - 1, y - 1, 4.5, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // brushed / scratch lines
  for (let k = 0; k < 2600; k++) {
    const x = R() * size, y = R() * size, a = R() * Math.PI, l = 10 + R() * 120;
    g.strokeStyle = R() < 0.5 ? `rgba(190,195,200,${0.05 + R() * 0.1})` : `rgba(20,20,22,${0.05 + R() * 0.12})`;
    g.lineWidth = 0.6 + R() * 1.4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    rg.strokeStyle = `rgba(60,60,60,0.3)`;
    rg.beginPath(); rg.moveTo(x, y); rg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); rg.stroke();
  }
  // tire marks: long dark curves
  for (let k = 0; k < 70; k++) {
    let x = R() * size, y = R() * size, a = R() * Math.PI * 2;
    g.strokeStyle = `rgba(12,12,12,${0.07 + R() * 0.1})`;
    g.lineWidth = 12 + R() * 16;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      a += (R() - 0.5) * 0.6;
      x += Math.cos(a) * 40; y += Math.sin(a) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // weld seams
  g.strokeStyle = '#33363a';
  g.lineWidth = 6;
  for (let i = 0; i <= plates; i++) {
    g.beginPath(); g.moveTo(i * p, 0); g.lineTo(i * p, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * p); g.lineTo(size, i * p); g.stroke();
  }
  rg.strokeStyle = '#ddd'; rg.lineWidth = 6;
  for (let i = 0; i <= plates; i++) {
    rg.beginPath(); rg.moveTo(i * p, 0); rg.lineTo(i * p, size); rg.stroke();
    rg.beginPath(); rg.moveTo(0, i * p); rg.lineTo(size, i * p); rg.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(rc);
  rough.anisotropy = 8;
  return { map, rough, canvas: c, ctx: g };
}

/** Yellow/black hazard stripes. */
export function hazardStripes(w = 512, h = 64) {
  const [c, g] = canvas(w, h);
  g.fillStyle = '#f2c400';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111';
  for (let x = -h; x < w + h; x += h) {
    g.beginPath(); g.moveTo(x, h); g.lineTo(x + h / 2, h); g.lineTo(x + h, 0); g.lineTo(x + h / 2, 0); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function brushedMetal(seed = 3, tint = '#a8adb3') {
  const [c, g] = canvas(512, 512);
  const R = rand(seed);
  g.fillStyle = tint;
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) {
    g.fillStyle = `rgba(${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},0.04)`;
    g.fillRect(0, y, 512, 1);
  }
  for (let k = 0; k < 300; k++) {
    g.strokeStyle = `rgba(0,0,0,${R() * 0.15})`;
    g.beginPath();
    const x = R() * 512, y = R() * 512;
    g.moveTo(x, y); g.lineTo(x + R() * 60 - 30, y + R() * 6 - 3); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Soft round sprite for smoke and glow. */
export function softSprite() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Text label texture (robot names on top decks, arena signage). */
export function textTexture(text: string, opts: { color?: string; bg?: string; font?: string; w?: number; h?: number; stroke?: string } = {}) {
  const w = opts.w ?? 1024, h = opts.h ?? 256;
  const [c, g] = canvas(w, h);
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, w, h); }
  let size = h * 0.7;
  g.font = `900 ${size}px ${opts.font ?? '"Oswald", "Impact", "Arial Black", sans-serif'}`;
  while (g.measureText(text).width > w * 0.92 && size > 10) {
    size -= 4;
    g.font = `900 ${size}px ${opts.font ?? '"Oswald", "Impact", "Arial Black", sans-serif'}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = size * 0.12;
    g.strokeStyle = opts.stroke;
    g.strokeText(text, w / 2, h / 2);
  }
  g.fillStyle = opts.color ?? '#fff';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Crowd: a strip of tiny people silhouettes. */
export function crowdTexture(seed = 11) {
  const [c, g] = canvas(2048, 256);
  const R = rand(seed);
  g.fillStyle = '#07080b';
  g.fillRect(0, 0, 2048, 256);
  for (let row = 0; row < 5; row++) {
    for (let x = 0; x < 2048; x += 14 + R() * 6) {
      const y = 40 + row * 44 + R() * 8;
      const hue = Math.floor(R() * 360);
      const lum = 18 + R() * 30;
      g.fillStyle = `hsl(${hue},${30 + R() * 40}%,${lum}%)`;
      g.fillRect(x, y + 12, 11, 30);
      g.fillStyle = `hsl(25,30%,${20 + R() * 35}%)`;
      g.beginPath(); g.arc(x + 5.5, y + 6, 6, 0, Math.PI * 2); g.fill();
      if (R() < 0.15) { g.fillStyle = `hsl(${hue},80%,60%)`; g.fillRect(x - 2, y - 10, 4, 18); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Paint patterns for robot panels. */
export function paintTexture(primary: string, secondary: string, accent: string, pattern: string, seed = 1) {
  const [c, g] = canvas(512, 512);
  const R = rand(seed);
  g.fillStyle = primary;
  g.fillRect(0, 0, 512, 512);
  switch (pattern) {
    case 'stripes':
      g.fillStyle = secondary;
      for (let x = 0; x < 512; x += 128) g.fillRect(x, 0, 48, 512);
      break;
    case 'split':
      g.fillStyle = secondary;
      g.fillRect(0, 256, 512, 256);
      break;
    case 'checker':
      g.fillStyle = secondary;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) g.fillRect(i * 64, j * 64, 64, 64);
      break;
    case 'flames': {
      g.fillStyle = accent;
      for (let i = 0; i < 9; i++) {
        const x = i * 60 + 10;
        g.beginPath(); g.moveTo(x, 512);
        g.quadraticCurveTo(x + 40, 300, x + 10 + R() * 30, 120 + R() * 80);
        g.quadraticCurveTo(x + 50, 320, x + 60, 512);
        g.fill();
      }
      g.fillStyle = secondary;
      for (let i = 0; i < 9; i++) {
        const x = i * 60 + 22;
        g.beginPath(); g.moveTo(x, 512);
        g.quadraticCurveTo(x + 25, 380, x + 15, 260 + R() * 60);
        g.quadraticCurveTo(x + 35, 400, x + 38, 512);
        g.fill();
      }
      break;
    }
    case 'tiger':
      g.fillStyle = secondary;
      for (let i = 0; i < 14; i++) {
        const y = i * 38 + R() * 10;
        g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(140 + R() * 80, y + 18, 300 + R() * 160, y + 4); g.lineTo(0, y + 14); g.fill();
      }
      break;
    case 'jagged':
      // white saw-tooth bands along the edges (Calypso's crab graphics)
      g.fillStyle = '#ffffff';
      for (const y0 of [0, 512]) {
        g.beginPath(); g.moveTo(0, y0);
        g.fillRect(0, y0 === 0 ? 0 : 440, 512, 72);
        for (let x = 0; x <= 512; x += 40) { g.lineTo(x + 20, y0 === 0 ? 120 + R() * 70 : 392 - R() * 70); g.lineTo(x + 40, y0); }
        g.closePath(); g.fill();
      }
      break;
    case 'marble':
      // hand-painted red/blue marbling: wandering thick strokes of the secondary colour
      for (let k = 0; k < 26; k++) {
        g.strokeStyle = k % 3 === 2 ? accent : secondary;
        g.globalAlpha = 0.55 + R() * 0.4;
        g.lineWidth = 8 + R() * 30;
        g.beginPath();
        let x = R() * 512, y = R() * 512;
        g.moveTo(x, y);
        for (let j = 0; j < 6; j++) { const nx = x + (R() - 0.5) * 260, ny = y + (R() - 0.5) * 260; g.quadraticCurveTo(x + (R() - 0.5) * 200, y + (R() - 0.5) * 200, nx, ny); x = nx; y = ny; }
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    case 'rivets':
      g.fillStyle = secondary;
      for (let x = 24; x < 512; x += 64) for (let y = 24; y < 512; y += 64) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
      break;
    case 'carbon':
      for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) {
        g.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
        g.fillRect(i * 8, j * 8, 8, 8);
      }
      break;
  }
  // wear: scratches and chipped paint
  for (let k = 0; k < 160; k++) {
    g.strokeStyle = `rgba(200,200,200,${R() * 0.18})`;
    g.lineWidth = R() * 2;
    const x = R() * 512, y = R() * 512;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + R() * 50 - 25, y + R() * 50 - 25); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
