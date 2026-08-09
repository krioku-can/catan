import { generateBoard, getHexCorners, hexToPixel } from './client/src/game/board.ts';
const HEX_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];
const { tiles } = generateBoard();
const land = new Set(tiles.map(t => `${t.q},${t.r}`));
function cornerLand(cq, cr) {
  const r = [];
  for (const t of tiles) if (getHexCorners(t.q, t.r).includes(`${cq},${cr}`)) r.push(`(${t.q},${t.r})`);
  return r;
}
// VALID port edge = BOTH endpoints coastal (1-2 land) AND the edge faces water.
const all = [];
for (const t of tiles) {
  const c = getHexCorners(t.q, t.r);
  for (let dir = 0; dir < 6; dir++) {
    const a = c[dir], b = c[(dir + 1) % 6];
    const na = cornerLand(...a.split(',').map(Number)).length;
    const nb = cornerLand(...b.split(',').map(Number)).length;
    if (na < 1 || na > 2 || nb < 1 || nb > 2) continue; // must be coastal corners
    const n = HEX_DIRECTIONS[dir];
    const facesWater = !land.has(`${t.q + n.q},${t.r + n.r}`);
    if (!facesWater) continue; // edge must face water
    const cc = hexToPixel(t.q, t.r, 1);
    const a0 = (Math.PI / 3) * dir - Math.PI / 6;
    const a1 = dir === 5 ? a0 + Math.PI / 3 : (Math.PI / 3) * ((dir + 1) % 6) - Math.PI / 6;
    const px = cc.x + 0.9 * ((Math.cos(a0) + Math.cos(a1)) / 2);
    const py = cc.y + 0.9 * ((Math.sin(a0) + Math.sin(a1)) / 2);
    all.push({ q: t.q, r: t.r, dir, a, b, na, nb, ang: Math.atan2(py, px) });
  }
}
const ek = e => [e.a, e.b].sort().join('|');
const uniq = [...new Map(all.map(e => [ek(e), e])).values()].sort((x, y) => x.ang - y.ang);
console.log('VALID edges (coastal corners + faces water):', uniq.length);
uniq.forEach((e, i) =>
  console.log(i, `ang ${(e.ang * 180 / Math.PI).toFixed(0).padStart(4)}`, `({${e.q},${e.r}})dir${e.dir}`, e.a, e.b)
);

// Pick 9 disjoint, evenly spread (every ~1.5th edge)
const used = new Set();
const picked = [];
const step = uniq.length / 9;
for (let i = 0; i < 9; i++) {
  let idx = Math.round(i * step) % uniq.length;
  let chosen = null;
  for (let off = 0; off < 8 && !chosen; off++) {
    for (const cand of [uniq[(idx + off) % uniq.length], uniq[(idx - off + uniq.length) % uniq.length]]) {
      if (used.has(cand.a) || used.has(cand.b)) continue;
      chosen = cand;
      break;
    }
  }
  if (chosen) { used.add(chosen.a); used.add(chosen.b); picked.push(chosen); }
}
console.log('\nPICKED 9:');
picked.sort((a, b) => a.ang - b.ang).forEach((e, i) =>
  console.log(i, `ang ${(e.ang * 180 / Math.PI).toFixed(0).padStart(4)}`, `({${e.q},${e.r}})dir${e.dir}`, e.a, e.b)
);
const g = [];
for (let i = 0; i < picked.length; i++) g.push((((picked[(i + 1) % picked.length].ang - picked[i].ang) + 2 * Math.PI) % (2 * Math.PI)) * 180 / Math.PI);
console.log('gaps deg:', g.map(x => x.toFixed(0)).join(', '));
const check = new Set(); let sh = 0;
for (const e of picked) { if (check.has(e.a)) sh++; if (check.has(e.b)) sh++; check.add(e.a); check.add(e.b); }
console.log('shared corners:', sh);
