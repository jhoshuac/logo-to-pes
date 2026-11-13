/* Stitch engine: flat logo image -> embroidery stitches -> Brother PES file.
   Pure JavaScript, no DOM: runs in a Web Worker, on the page, or in Node. */
(function (root) {
'use strict';

const STITCH = 0, JUMP = 1, TRIM = 2, END = 4, COLOR_CHANGE = 5;
const INF = 1e20;

/* ------------------------------------------------------------ distance transform */
function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/* squared distance from every pixel to the nearest feature pixel (feat[i] = 1).
   padFeature: treat the area outside the image as feature. */
function sqDist(feat, W, H, padFeature) {
  const W2 = W + 2, H2 = H + 2;
  const g = new Float64Array(W2 * H2);
  const pv = padFeature ? 0 : INF;
  g.fill(pv);
  for (let y = 0; y < H; y++) {
    const ro = (y + 1) * W2 + 1, ri = y * W;
    for (let x = 0; x < W; x++) g[ro + x] = feat[ri + x] ? 0 : INF;
  }
  const n = Math.max(W2, H2);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W2; x++) {
    for (let y = 0; y < H2; y++) f[y] = g[y * W2 + x];
    dt1d(f, H2, d, v, z);
    for (let y = 0; y < H2; y++) g[y * W2 + x] = d[y];
  }
  for (let y = 0; y < H2; y++) {
    const o = y * W2;
    for (let x = 0; x < W2; x++) f[x] = g[o + x];
    dt1d(f, W2, d, v, z);
    for (let x = 0; x < W2; x++) g[o + x] = d[x];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const ro = (y + 1) * W2 + 1, ri = y * W;
    for (let x = 0; x < W; x++) out[ri + x] = g[ro + x];
  }
  return out;
}
function distIn(M, W, H) {           // distance (px) to nearest pixel outside M
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = M[i] ? 0 : 1;
  const d = sqDist(inv, W, H, true);
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  return d;
}
function distTo(M, W, H) {           // distance (px) to nearest pixel of M
  const d = sqDist(M, W, H, false);
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  return d;
}
function thresh(d, fn) {
  const o = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) o[i] = fn(d[i]) ? 1 : 0;
  return o;
}
function erode(M, W, H, r) { const d = distIn(M, W, H); return thresh(d, v => v > r); }
function dilate(M, W, H, r) { const d = distTo(M, W, H); return thresh(d, v => v <= r); }
function openMask(M, W, H, r, dIn) {
  const d = dIn || distIn(M, W, H);
  const centers = thresh(d, v => v > r);
  const o = dilate(centers, W, H, r);
  for (let i = 0; i < o.length; i++) o[i] = o[i] & M[i];
  return o;
}
function and(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] & b[i]; return o; }
function or(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] | b[i]; return o; }
function andNot(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] & (b[i] ? 0 : 1); return o; }

function labelComponents(mask, W, H) {
  const lab = new Int32Array(W * H), q = new Int32Array(W * H), comps = [];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lab[i]) continue;
    n++;
    let h = 0, t = 0;
    q[t++] = i; lab[i] = n;
    const c = { id: n, count: 0, minx: W, miny: H, maxx: 0, maxy: 0 };
    while (h < t) {
      const p = q[h++];
      c.count++;
      const x = p % W, y = (p / W) | 0;
      if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x;
      if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; if (nx < 0 || nx >= W) continue;
          const j = ny * W + nx;
          if (mask[j] && !lab[j]) { lab[j] = n; q[t++] = j; }
        }
      }
    }
    comps.push(c);
  }
  return { lab, comps };
}

/* ------------------------------------------------------------ thinning (Zhang-Suen) */
function thin(mask, W, H) {
  const img = Uint8Array.from(mask);
  for (let x = 0; x < W; x++) { img[x] = 0; img[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { img[y * W] = 0; img[y * W + W - 1] = 0; }
  const inQ = new Uint8Array(W * H);
  let cand = [];
  for (let i = 0; i < W * H; i++) {
    if (!img[i]) continue;
    if (!img[i - 1] || !img[i + 1] || !img[i - W] || !img[i + W]) { cand.push(i); inQ[i] = 1; }
  }
  for (let iter = 0; iter < 10000; iter++) {
    let any = false;
    for (let sub = 0; sub < 2; sub++) {
      const del = [];
      for (const p of cand) {
        if (!img[p]) continue;
        const p2 = img[p - W], p3 = img[p - W + 1], p4 = img[p + 1], p5 = img[p + W + 1],
          p6 = img[p + W], p7 = img[p + W - 1], p8 = img[p - 1], p9 = img[p - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (sub === 0) { if (p2 && p4 && p6) continue; if (p4 && p6 && p8) continue; }
        else { if (p2 && p4 && p8) continue; if (p2 && p6 && p8) continue; }
        del.push(p);
      }
      if (del.length) any = true;
      for (const p of del) img[p] = 0;
      const next = [];
      for (const p of cand) { inQ[p] = 0; }
      for (const p of cand) if (img[p] && !inQ[p]) { inQ[p] = 1; next.push(p); }
      for (const p of del) {
        const nb = [p - W - 1, p - W, p - W + 1, p - 1, p + 1, p + W - 1, p + W, p + W + 1];
        for (const j of nb) if (img[j] && !inQ[j]) { inQ[j] = 1; next.push(j); }
      }
      cand = next;
    }
    if (!any) break;
  }
  // remove staircase corners so lines are exactly one pixel wide (8-connected)
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (!img[p]) continue;
      const e = img[p + 1], ne = img[p - W + 1], n = img[p - W], nw = img[p - W - 1],
        w = img[p - 1], sw = img[p + W - 1], s = img[p + W], se = img[p + W + 1];
      if (!((n && e) || (e && s) || (s && w) || (w && n))) continue;
      // Yokoi 8-connectivity number: 1 means removing p keeps its neighbours connected
      const x1 = 1 - e, x2 = 1 - ne, x3 = 1 - n, x4 = 1 - nw, x5 = 1 - w, x6 = 1 - sw, x7 = 1 - s, x8 = 1 - se;
      const c8 = (x1 - x1 * x2 * x3) + (x3 - x3 * x4 * x5) + (x5 - x5 * x6 * x7) + (x7 - x7 * x8 * x1);
      if (c8 === 1) { img[p] = 0; changed++; }
    }
    if (!changed) break;
  }
  return img;
}

/* ------------------------------------------------------------ skeleton graph */
function skeletonGraph(sk, W, H) {
  const NB = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  const deg = new Uint8Array(W * H);
  const pts = [];
  for (let i = 0; i < W * H; i++) {
    if (!sk[i]) continue;
    pts.push(i);
    let c = 0;
    for (const o of NB) if (sk[i + o]) c++;
    deg[i] = c;
  }
  const nodeOf = new Int32Array(W * H).fill(-1);
  const nodePos = [];
  // cluster node pixels (deg != 2)
  for (const i of pts) {
    if (deg[i] === 2 || nodeOf[i] >= 0) continue;
    const id = nodePos.length;
    const stack = [i]; nodeOf[i] = id;
    let sx = 0, sy = 0, n = 0;
    while (stack.length) {
      const p = stack.pop();
      sx += p % W; sy += (p / W) | 0; n++;
      for (const o of NB) {
        const j = p + o;
        if (sk[j] && deg[j] !== 2 && nodeOf[j] < 0) { nodeOf[j] = id; stack.push(j); }
      }
    }
    nodePos.push([sx / n, sy / n]);
  }
  const visited = new Uint8Array(W * H);
  const edges = [];
  function trace(startPx, first) {
    const startNode = nodeOf[startPx];
    const path = [startPx, first];
    visited[first] = 1;
    let prev = startPx, cur = first;
    for (;;) {
      if (nodeOf[cur] >= 0) return [path, nodeOf[cur]];
      let nxt = -1;
      for (const o of NB) {
        const q = cur + o;
        if (!sk[q] || q === prev) continue;
        if (visited[q] && nodeOf[q] < 0) continue;
        if (nodeOf[q] >= 0 && nodeOf[q] === startNode && path.length < 3) continue;
        nxt = q;
        if (nodeOf[q] < 0) break;
      }
      if (nxt < 0) return [path, -1];
      if (nodeOf[nxt] < 0) visited[nxt] = 1;
      path.push(nxt);
      prev = cur; cur = nxt;
    }
  }
  for (const p of pts) {
    if (nodeOf[p] < 0) continue;
    for (const o of NB) {
      const q = p + o;
      if (!sk[q] || nodeOf[q] >= 0 || visited[q]) continue;
      let [path, end] = trace(p, q);
      if (end < 0) {
        const last = path[path.length - 1];
        end = nodePos.length; nodePos.push([last % W, (last / W) | 0]); nodeOf[last] = end;
      }
      edges.push([nodeOf[p], end, path]);
    }
  }
  // pure cycles
  for (const p of pts) {
    if (visited[p] || nodeOf[p] >= 0) continue;
    const id = nodePos.length; nodePos.push([p % W, (p / W) | 0]); nodeOf[p] = id;
    for (const o of NB) {
      const q = p + o;
      if (sk[q] && !visited[q] && nodeOf[q] < 0) {
        let [path, end] = trace(p, q);
        if (end < 0) end = id;
        edges.push([id, end, path]);
        break;
      }
    }
  }
  return { nodePos, edges };
}

function pruneEdges(edges, minLenPx) {
  for (let it = 0; it < 3; it++) {
    const deg = new Map();
    for (const [a, b] of edges) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
    const keep = edges.filter(([a, b, p]) => {
      const da = deg.get(a), db = deg.get(b);
      const leaf = (da === 1) !== (db === 1);
      const iso = da === 1 && db === 1;
      return !((leaf || iso) && p.length < minLenPx);
    });
    if (keep.length === edges.length) break;
    edges = keep;
  }
  return edges;
}

/* ------------------------------------------------------------ geometry helpers (mm) */
function hyp(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function runPath(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = hyp(a, b);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
function interp(t, s, arr) {        // piecewise linear interpolation of arr at arclength t
  // binary search
  let lo = 0, hi = s.length - 1;
  if (t <= s[0]) return arr[0];
  if (t >= s[hi]) return arr[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= t) lo = m; else hi = m; }
  const f = (t - s[lo]) / Math.max(1e-9, s[hi] - s[lo]);
  return arr[lo] + (arr[hi] - arr[lo]) * f;
}
function resample(xy, w, step) {
  const n0 = xy.length;
  const s = new Float64Array(n0);
  for (let i = 1; i < n0; i++) s[i] = s[i - 1] + hyp(xy[i - 1], xy[i]);
  const L = s[n0 - 1];
  const X = xy.map(p => p[0]), Y = xy.map(p => p[1]);
  if (L < 1e-6) return { P: [xy[0]], W: [w[0]], N: [[0, 0]], L: 0 };
  const n = Math.max(1, Math.round(L / step));
  const P = [], WW = [], N = [];
  const tw = 0.6;
  for (let i = 0; i <= n; i++) {
    const t = L * i / n;
    P.push([interp(t, s, X), interp(t, s, Y)]);
    WW.push(interp(t, s, w));
    const t1 = Math.max(0, t - tw), t2 = Math.min(L, t + tw);
    let dx = interp(t2, s, X) - interp(t1, s, X), dy = interp(t2, s, Y) - interp(t1, s, Y);
    const dl = Math.hypot(dx, dy) || 1e-9;
    dx /= dl; dy /= dl;
    N.push([-dy, dx]);
  }
  return { P, W: WW, N, L };
}
function underlayPath(xy, w, level) {
  // light: a walk down the middle; normal: narrow zigzag; heavy: wider, closer zigzag
  const heavy = level === 'heavy', light = level === 'light';
  const r = resample(xy, w, heavy ? 0.8 : 1.0);
  return r.P.map((p, i) => {
    const amt = light ? 0 : heavy ? Math.max(0, 0.38 * r.W[i] - 0.2) : Math.max(0, 0.3 * r.W[i] - 0.25);
    const off = amt * (i % 2 ? 1 : -1);
    return [p[0] + r.N[i][0] * off, p[1] + r.N[i][1] * off];
  });
}
function satinPath(xy, w, pull, base) {
  let wmax = 0; for (const v of w) wmax = Math.max(wmax, v);
  base = base || 0.4;                       // peak-to-peak distance between zigzags, mm
  const spacing = wmax < 1.3 ? base * 1.1 : base;
  const r = resample(xy, w, spacing / 2);
  return r.P.map((p, i) => {
    const side = i % 2 ? 1 : -1;
    const h = (r.W[i] + pull) / 2 * side;
    return [p[0] + r.N[i][0] * h, p[1] + r.N[i][1] * h];
  });
}
function extendTip(xy, w, atEnd, dist) {
  if (xy.length < 3 || dist <= 0) return [xy, w];
  if (!atEnd) {
    const [a, b] = extendTip(xy.slice().reverse(), w.slice().reverse(), true, dist);
    return [a.reverse(), b.reverse()];
  }
  const j = Math.max(0, xy.length - 6);
  let dx = xy[xy.length - 1][0] - xy[j][0], dy = xy[xy.length - 1][1] - xy[j][1];
  const nd = Math.hypot(dx, dy);
  if (nd < 1e-6) return [xy, w];
  dx /= nd; dy /= nd;
  const k = Math.max(2, Math.floor(dist / 0.1));
  const last = xy[xy.length - 1], wl = w[w.length - 1];
  const X = xy.slice(), WW = w.slice();
  for (let i = 1; i <= k; i++) {
    X.push([last[0] + dx * dist * i / k, last[1] + dy * dist * i / k]);
    WW.push(wl * (1 - 0.75 * i / k));
  }
  return [X, WW];
}

/* ------------------------------------------------------------ satin network */
function networkBlocks(sk, D, W, H, mmpx, opt) {
  const { nodePos, edges: raw } = skeletonGraph(sk, W, H);
  const edges = pruneEdges(raw, opt.pruneMM / mmpx);
  const deg = new Map();
  for (const [a, b] of edges) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
  const k = Math.max(1, Math.round(0.4 / mmpx)) | 1;
  const E = edges.map(([a, b, path]) => {
    let xy = path.map(p => [(p % W) * mmpx, ((p / W) | 0) * mmpx]);
    let w = path.map(p => Math.max(0, 2 * D[p] - 1) * mmpx);
    if (xy.length >= k) {           // moving-average smoothing
      const h = k >> 1, n = xy.length;
      const sx = [], sw = [];
      for (let i = 0; i < n; i++) {
        let ax = 0, ay = 0, aw = 0;
        for (let j = -h; j <= h; j++) {
          const q = Math.min(n - 1, Math.max(0, i + j));
          ax += xy[q][0]; ay += xy[q][1]; aw += w[q];
        }
        sx.push([ax / k, ay / k]); sw.push(aw / k);
      }
      sx[0] = xy[0]; sx[n - 1] = xy[n - 1];
      xy = sx; w = sw;
    }
    w = w.map(v => Math.min(opt.maxW + 0.3, Math.max(opt.minW, v + opt.extraW)));
    if (deg.get(a) === 1) [xy, w] = extendTip(xy, w, false, w[0] / 2 * 0.8);
    if (deg.get(b) === 1) [xy, w] = extendTip(xy, w, true, w[w.length - 1] / 2 * 0.8);
    return { a, b, xy, w };
  });
  const adj = new Map();
  E.forEach((e, i) => {
    if (!adj.has(e.a)) adj.set(e.a, []);
    adj.get(e.a).push(i);
    if (e.b !== e.a) { if (!adj.has(e.b)) adj.set(e.b, []); adj.get(e.b).push(i); }
  });
  for (const [, list] of adj) list.sort((x, y) => E[y].xy.length - E[x].xy.length);
  // components
  const seen = new Set(), comps = [];
  for (const n0 of adj.keys()) {
    if (seen.has(n0)) continue;
    const st = [n0], comp = []; seen.add(n0);
    while (st.length) {
      const u = st.pop(); comp.push(u);
      for (const ei of adj.get(u)) {
        const v = E[ei].a === u ? E[ei].b : E[ei].a;
        if (!seen.has(v)) { seen.add(v); st.push(v); }
      }
    }
    comps.push(comp);
  }
  const nodeXY = id => [nodePos[id][0] * mmpx, nodePos[id][1] * mmpx];
  function stitchComp(start) {
    const out = [], used = new Set(), vis = new Set([start]);
    const stack = [{ u: start, i: 0, back: null }];
    while (stack.length) {
      const f = stack[stack.length - 1];
      const list = adj.get(f.u);
      if (f.i >= list.length) {
        stack.pop();
        if (f.back) out.push(...satinPath(f.back.xy, f.back.w, opt.pull, opt.satinSpacing));
        continue;
      }
      const ei = list[f.i++];
      if (used.has(ei)) continue;
      used.add(ei);
      const e = E[ei];
      let v, fxy, fw;
      if (e.a === f.u) { v = e.b; fxy = e.xy; fw = e.w; }
      else { v = e.a; fxy = e.xy.slice().reverse(); fw = e.w.slice().reverse(); }
      out.push(...underlayPath(fxy, fw, opt.underlay));
      const back = { xy: fxy.slice().reverse(), w: fw.slice().reverse() };
      if (!vis.has(v)) { vis.add(v); stack.push({ u: v, i: 0, back }); }
      else out.push(...satinPath(back.xy, back.w, opt.pull, opt.satinSpacing));
    }
    return out;
  }
  return comps.map(comp => {
    const leaves = comp.filter(u => adj.get(u).length === 1);
    return { cand: leaves.length ? leaves : comp, fn: stitchComp, nodeXY };
  });
}

function orderNetworks(blocks, cur) {
  const left = blocks.slice(), seqs = [];
  while (left.length) {
    let best = null;
    left.forEach((b, bi) => {
      for (const u of b.cand) {
        const d = hyp(b.nodeXY(u), cur);
        if (!best || d < best.d) best = { d, bi, u };
      }
    });
    const b = left.splice(best.bi, 1)[0];
    const s = b.fn(best.u);
    if (s.length) { seqs.push(s); cur = s[s.length - 1]; }
  }
  return { seqs, cur };
}

/* ------------------------------------------------------------ fill (tatami) */
function makeTravelGrid(comp, W, mmpx, mask, hiddenMask) {
  const cell = Math.max(2, Math.round(0.5 / mmpx));
  const gx0 = comp.minx, gy0 = comp.miny;
  const GW = Math.floor((comp.maxx - comp.minx) / cell) + 1;
  const GH = Math.floor((comp.maxy - comp.miny) / cell) + 1;
  const inside = new Uint8Array(GW * GH), edge = new Uint8Array(GW * GH), filled = new Uint8Array(GW * GH), hidden = new Uint8Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = Math.min(comp.maxx, gx0 + i * cell + (cell >> 1)), y = Math.min(comp.maxy, gy0 + j * cell + (cell >> 1));
    inside[j * GW + i] = mask[y * W + x] ? 1 : 0;
    // cells under a colour stitched later: travel there is covered up afterwards
    if (!inside[j * GW + i] && hiddenMask && hiddenMask[y * W + x]) { inside[j * GW + i] = 1; hidden[j * GW + i] = 1; }
  }
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const c = j * GW + i;
    if (!inside[c]) continue;
    if (hidden[c]) continue;
    if (i === 0 || j === 0 || i === GW - 1 || j === GH - 1 || !inside[c - 1] || !inside[c + 1] || !inside[c - GW] || !inside[c + GW]) edge[c] = 1;
  }
  return { cell, gx0, gy0, GW, GH, inside, edge, filled, hidden, mmpx };
}
function gridCellOf(g, p) {
  const i = Math.round((p[0] / g.mmpx - g.gx0 - (g.cell >> 1)) / g.cell);
  const j = Math.round((p[1] / g.mmpx - g.gy0 - (g.cell >> 1)) / g.cell);
  let best = -1, bd = Infinity;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= g.GW || jj >= g.GH) continue;
    const c = jj * g.GW + ii;
    if (!g.inside[c]) continue;
    const d = di * di + dj * dj;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function cellXY(g, c) {
  const i = c % g.GW, j = (c / g.GW) | 0;
  return [(g.gx0 + i * g.cell + (g.cell >> 1)) * g.mmpx, (g.gy0 + j * g.cell + (g.cell >> 1)) * g.mmpx];
}
function markFilled(g, a, b) {
  const n = Math.max(1, Math.ceil(hyp(a, b) / (g.cell * g.mmpx * 0.5)));
  for (let k = 0; k <= n; k++) {
    const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
    const i = Math.floor(p[0] / g.mmpx - g.gx0) / g.cell | 0, j = Math.floor(p[1] / g.mmpx - g.gy0) / g.cell | 0;
    if (i >= 0 && j >= 0 && i < g.GW && j < g.GH) g.filled[j * g.GW + i] = 1;
  }
}
function dijkstra(g, s, t, penalizeFilled) {
  const N = g.GW * g.GH;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap = [];        // binary heap of [d, c]
  const push = (d, c) => { heap.push([d, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  dist[s] = 0; push(0, s);
  const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (heap.length) {
    const [d, c] = pop();
    if (c === t) break;
    if (d > dist[c]) continue;
    const ci = c % g.GW, cj = (c / g.GW) | 0;
    for (const [di, dj, w] of D8) {
      const ii = ci + di, jj = cj + dj;
      if (ii < 0 || jj < 0 || ii >= g.GW || jj >= g.GH) continue;
      const n = jj * g.GW + ii;
      if (!g.inside[n]) continue;
      let cost = g.hidden[n] ? 0.9 : g.edge[n] ? 1.3 : 1;
      if (penalizeFilled && g.filled[n] && !g.edge[n] && !g.hidden[n]) cost = 14;
      const nd = d + w * cost;
      if (nd < dist[n]) { dist[n] = nd; prev[n] = c; push(nd, n); }
    }
  }
  if (!isFinite(dist[t])) return null;
  const path = [];
  for (let c = t; c >= 0; c = prev[c]) path.push(c);
  return path.reverse();
}
function simplifyDP(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function tatami(mask, W, H, comp, mmpx, angleDeg, spacingMM, stitchMM, cur, grid, visible, pullMM) {
  const out = [];
  const a = angleDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const corners = [[comp.minx, comp.miny], [comp.maxx + 1, comp.miny], [comp.minx, comp.maxy + 1], [comp.maxx + 1, comp.maxy + 1]];
  let smin = Infinity, smax = -Infinity, tmin = Infinity, tmax = -Infinity;
  for (const [x, y] of corners) {
    const s = x * ux + y * uy, t = x * vx + y * vy;
    smin = Math.min(smin, s); smax = Math.max(smax, s); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
  }
  const sp = spacingMM / mmpx, minSeg = 0.4 / mmpx, step = 0.5;
  const rows = [];
  for (let t = tmin + sp * 0.5; t < tmax; t += sp) {
    const segs = [];
    let inside = false, s0 = 0;
    for (let s = smin; s <= smax + step; s += step) {
      const x = Math.round(s * ux + t * vx), y = Math.round(s * uy + t * vy);
      const isIn = x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
      if (isIn && !inside) { inside = true; s0 = s - step / 2; }
      else if (!isIn && inside) { inside = false; const s1 = s - step / 2; if (s1 - s0 >= minSeg) segs.push([s0, s1]); }
    }
    rows.push({ t, segs });
  }
  // sections: runs of rows where each row has one segment overlapping exactly one in the next
  const sections = [];
  let open = new Map(), prev = [];
  const ovl = 1;
  rows.forEach((row, r) => {
    const nopen = new Map();
    row.segs.forEach(([a0, b0], j) => {
      const ov = [];
      prev.forEach(([c, d], i) => { if (Math.min(b0, d) - Math.max(a0, c) > ovl) ov.push(i); });
      if (ov.length === 1 && open.has(ov[0])) {
        const i = ov[0];
        const back = row.segs.filter(([aa, bb]) => Math.min(bb, prev[i][1]) - Math.max(aa, prev[i][0]) > ovl);
        if (back.length === 1) {
          const sid = open.get(i);
          sections[sid].push([r, a0, b0]); nopen.set(j, sid); return;
        }
      }
      const sid = sections.length; sections.push([[r, a0, b0]]); nopen.set(j, sid);
    });
    open = nopen; prev = row.segs;
  });
  const toMM = (s, t) => [(s * ux + t * vx) * mmpx, (s * uy + t * vy) * mmpx];
  const L = stitchMM / mmpx, endGap = 0.6 / mmpx;
  const ext = (pullMM || 0) / mmpx;          // pull compensation: rows reach a little past the edge
  function rowPts(r, a0, b0, ltr) {
    a0 -= ext; b0 += ext;
    const t = rows[r].t;
    const off = (r % 3) / 3 * L;
    const xs = [a0];
    let x = Math.floor((a0 - off) / L) * L + off;
    while (x < b0) { if (x > a0 + endGap && x < b0 - endGap) xs.push(x); x += L; }
    xs.push(b0);
    if (!ltr) xs.reverse();
    return xs.map(s => toMM(s, t));
  }
  function entries(sec) {
    const res = [];
    for (const top of [true, false]) for (const ltr of [true, false]) {
      const [r, a0, b0] = top ? sec[0] : sec[sec.length - 1];
      res.push({ top, ltr, st: toMM(ltr ? a0 : b0, rows[r].t) });
    }
    return res;
  }
  function emit(sec, top, ltr) {
    const rr = top ? sec : sec.slice().reverse();
    const pts = []; let d = ltr;
    for (const [r, a0, b0] of rr) {
      const rp = rowPts(r, a0, b0, d);
      if (visible && grid) markFilled(grid, rp[0], rp[rp.length - 1]);
      pts.push(...rp); d = !d;
    }
    return pts;
  }
  function travel(p, q) {
    const dist = hyp(p, q);
    if (dist < 0.05) return;
    if (dist < 1.2) { out.push(['s', q]); return; }
    if (grid) {
      const cs = gridCellOf(grid, p), ct = gridCellOf(grid, q);
      if (cs >= 0 && ct >= 0) {
        const path = dijkstra(grid, cs, ct, visible);
        if (path) {
          const pts = simplifyDP([p, ...path.map(c => cellXY(grid, c)), q], 0.35);
          for (const z of runPath(pts, 2.0).slice(1)) out.push(['s', z]);
          return;
        }
      }
    }
    out.push(['j', q]);
  }
  const left = sections.map((_, i) => i);
  if (!cur) cur = toMM(sections.length ? sections[0][0][1] : 0, rows.length ? rows[0].t : 0);
  let first = true;
  while (left.length) {
    let best = null;
    for (const si of left) for (const e of entries(sections[si])) {
      const d = hyp(e.st, cur);
      if (!best || d < best.d) best = { d, si, e };
    }
    left.splice(left.indexOf(best.si), 1);
    if (first) { out.push(['j', best.e.st]); first = false; }
    else travel(cur, best.e.st);
    const pts = emit(sections[best.si], best.e.top, best.e.ltr);
    for (const z of pts) out.push(['s', z]);
    cur = pts[pts.length - 1];
  }
  return { seq: out, cur };
}

/* Moore-neighbour outer boundary of each component of mask (for an edge walk) */
function outerContours(mask, W, H, minPx) {
  const { lab, comps } = labelComponents(mask, W, H);
  const res = [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (const c of comps) {
    if (c.count < minPx) continue;
    // start: first pixel scanning row-major
    let sx = -1, sy = -1;
    outer: for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) if (lab[y * W + x] === c.id) { sx = x; sy = y; break outer; }
    const pts = [[sx, sy]];
    let x = sx, y = sy, dir = 7; // came from the left/top
    const isIn = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && lab[yy * W + xx] === c.id;
    for (let n = 0; n < 4 * c.count + 8; n++) {
      let found = false;
      const startDir = (dir + 6) % 8;
      for (let k = 0; k < 8; k++) {
        const d = (startDir + k) % 8;
        const nx = x + dirs[d][0], ny = y + dirs[d][1];
        if (isIn(nx, ny)) { x = nx; y = ny; dir = d; found = true; break; }
      }
      if (!found) break;
      if (x === sx && y === sy) break;
      pts.push([x, y]);
    }
    res.push(pts);
  }
  return res;
}

function fillComponent(fillMask, W0, H0, comp0, lab, mmpx, opt, cur0, laterMask) {
  // work in a cropped window around this shape, then shift back
  const m = 3;
  const ox = comp0.minx - m, oy = comp0.miny - m;
  const W = comp0.maxx - comp0.minx + 1 + 2 * m, H = comp0.maxy - comp0.miny + 1 + 2 * m;
  const cm = new Uint8Array(W * H);
  for (let y = comp0.miny; y <= comp0.maxy; y++) for (let x = comp0.minx; x <= comp0.maxx; x++) {
    if (lab[y * W0 + x] === comp0.id) cm[(y - oy) * W + (x - ox)] = 1;
  }
  const lm = new Uint8Array(W * H);
  if (laterMask) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = x + ox, gy = y + oy;
    if (gx >= 0 && gy >= 0 && gx < W0 && gy < H0 && laterMask[gy * W0 + gx]) lm[y * W + x] = 1;
  }
  const comp = { id: comp0.id, count: comp0.count, minx: m, miny: m, maxx: W - 1 - m, maxy: H - 1 - m };
  const sx = ox * mmpx, sy = oy * mmpx;
  const cur = cur0 ? [cur0[0] - sx, cur0[1] - sy] : null;
  const r = fillLocal(cm, W, H, comp, mmpx, opt, cur, lm);
  const shift = q => [q[0] + sx, q[1] + sy];
  return { seq: r.seq.map(([k, q]) => [k, shift(q)]), cur: r.cur ? shift(r.cur) : cur0 };
}
function fillLocal(cm, W, H, comp, mmpx, opt, cur, lm) {
  const seq = [];
  const grid = makeTravelGrid(comp, W, mmpx, cm, lm);
  const dIn = distIn(cm, W, H);
  // 1. edge walk just inside the outline
  const edgeMask = thresh(dIn, v => v > 0.4 / mmpx);
  for (const c of outerContours(edgeMask, W, H, 1.0 / (mmpx * mmpx))) {
    let pts = c.map(([x, y]) => [x * mmpx, y * mmpx]);
    pts = simplifyDP(pts.concat([pts[0]]), 0.15);
    if (pts.length < 3) continue;
    let bi = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = cur ? hyp(p, cur) : 0; if (d < bd) { bd = d; bi = i; } });
    const ring = pts.slice(bi, pts.length - 1).concat(pts.slice(0, bi + 1));
    seq.push(['j', ring[0]]);
    for (const z of runPath(ring, 2.0).slice(1)) seq.push(['s', z]);
    cur = ring[ring.length - 1];
  }
  // 2. sparse underlay across the fill direction
  const ul = thresh(dIn, v => v > 0.5 / mmpx);
  let any = false; for (let i = 0; i < ul.length && !any; i++) if (ul[i]) any = true;
  const layers = opt.underlay === 'light' ? [[90, 2.6]] : opt.underlay === 'heavy' ? [[90, 1.6], [0, 2.4]] : [[90, 1.8]];
  if (any) for (const [da, sp] of layers) {
    const r = tatami(ul, W, H, comp, mmpx, opt.angle + da, sp, 3.0, cur, grid, false);
    for (const it of r.seq) seq.push(it);
    if (r.seq.length) cur = r.cur;
  }
  // 3. top fill
  const r = tatami(cm, W, H, comp, mmpx, opt.angle, opt.density, opt.stitchLen, cur, grid, true, opt.pullMM);
  for (const it of r.seq) seq.push(it);
  return { seq, cur: r.seq.length ? r.cur : cur };
}

/* ------------------------------------------------------------ stitch builder */
class Builder {
  constructor() { this.cmds = []; this.cur = null; this.prev = null; this.needTie = true; this.trims = 0; this.hidden = 0; this.travel = null; }
  abs(c, q) { this.cmds.push([q[0], q[1], c]); }
  cmd(c) { this.abs(c, this.cur || [0, 0]); }
  tie(q, toward) {
    let v = [0.5, 0];
    if (!toward && this.prev) toward = this.prev;
    if (toward) {
      const dx = toward[0] - q[0], dy = toward[1] - q[1], L = Math.hypot(dx, dy);
      if (L > 1e-6) v = [dx / L * 0.5, dy / L * 0.5];
    }
    const b = [q[0] + v[0], q[1] + v[1]];
    for (const z of [q, b, q, b, q]) this.abs(STITCH, z);
  }
  canTravel(q) {
    // a straight run is fine if it stays inside this colour or under a colour stitched later
    const t = this.travel;
    if (!t || !this.cur || this.needTie) return false;
    const L = hyp(q, this.cur);
    if (L > 25) return false;
    const n = Math.max(1, Math.ceil(L / (t.mmpx * 0.8)));
    let exposed = 0;
    for (let k = 0; k <= n; k++) {
      const x = Math.round((this.cur[0] + (q[0] - this.cur[0]) * k / n) / t.mmpx);
      const y = Math.round((this.cur[1] + (q[1] - this.cur[1]) * k / n) / t.mmpx);
      if (x < 0 || y < 0 || x >= t.W || y >= t.H) return false;
      const v = t.mask[y * t.W + x];
      if (!v) return false;
      if (v === 1) exposed += L / n;
    }
    return exposed <= 1.5;
  }
  jump(q) {
    if (this.cur && hyp(q, this.cur) < 1.5) { this.stitch(q); return; }
    if (this.canTravel(q)) { for (const z of runPath([this.cur, q], 2.5).slice(1)) this.stitch(z); this.hidden++; return; }
    if (this.cur && !this.needTie) { this.tie(this.cur); this.cmd(TRIM); this.trims++; }
    this.abs(JUMP, q);
    this.cur = q; this.prev = null; this.needTie = true;
  }
  stitch(q) {
    if (!this.cur) this.jump(q);
    if (this.needTie) { this.needTie = false; this.tie(this.cur, q); }
    if (hyp(q, this.cur) < 0.3) return;
    for (const z of runPath([this.cur, q], 7.0).slice(1)) this.abs(STITCH, z);
    this.prev = this.cur; this.cur = q;
  }
  seq(items) { for (const [k, q] of items) { if (k === 'j') this.jump(q); else this.stitch(q); } }
  points(pts) { if (!pts.length) return; this.jump(pts[0]); for (let i = 1; i < pts.length; i++) this.stitch(pts[i]); }
  colorChange() { if (this.cur) this.tie(this.cur); this.cmd(COLOR_CHANGE); this.needTie = true; }
  end() { if (this.cur) this.tie(this.cur); this.cmd(TRIM); this.cmd(END); }
}

/* ------------------------------------------------------------ colours */
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function kmeans(samples, k, iters, rnd) {
  const n = samples.length / 3;
  const C = [];
  let i0 = Math.floor(rnd() * n);
  C.push([samples[i0 * 3], samples[i0 * 3 + 1], samples[i0 * 3 + 2]]);
  const dmin = new Float64Array(n).fill(Infinity);
  while (C.length < k) {
    const c = C[C.length - 1];
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const d = (samples[i * 3] - c[0]) ** 2 + (samples[i * 3 + 1] - c[1]) ** 2 + (samples[i * 3 + 2] - c[2]) ** 2;
      if (d < dmin[i]) dmin[i] = d;
      tot += dmin[i];
    }
    let r = rnd() * tot, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= dmin[i]; if (r <= 0) { pick = i; break; } }
    C.push([samples[pick * 3], samples[pick * 3 + 1], samples[pick * 3 + 2]]);
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let b = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (samples[i * 3] - C[j][0]) ** 2 + (samples[i * 3 + 1] - C[j][1]) ** 2 + (samples[i * 3 + 2] - C[j][2]) ** 2;
        if (d < bd) { bd = d; b = j; }
      }
      asg[i] = b;
      sum[b][0] += samples[i * 3]; sum[b][1] += samples[i * 3 + 1]; sum[b][2] += samples[i * 3 + 2]; sum[b][3]++;
    }
    for (let j = 0; j < k; j++) if (sum[j][3]) C[j] = [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]];
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) counts[asg[i]]++;
  return { centers: C, counts };
}
/* Find the logo's flat colours. rgba: Uint8ClampedArray, small analysis image. */
function analyzeColors(rgba, w, h, kMax) {
  kMax = kMax || 6;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  // colours are learned from flat parts of the picture only: soft edges between two colours
  // (anti-aliasing around outlines) would otherwise grab colours of their own
  const flatAt = (x, y) => {
    const i = (y * w + x) * 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = (yy * w + xx) * 4;
      if (rgba[j + 3] < 128) return false;
      if (Math.abs(rgba[i] - rgba[j]) + Math.abs(rgba[i + 1] - rgba[j + 1]) + Math.abs(rgba[i + 2] - rgba[j + 2]) > 48) return false;
    }
    return true;
  };
  const s = [], sAll = [];
  let transparent = 0, total = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4; total++;
    if (rgba[i + 3] < 128) { transparent++; continue; }
    sAll.push(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (flatAt(x, y)) s.push(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  const samples = Float64Array.from(s.length >= 0.3 * sAll.length && s.length >= 300 ? s : sAll);
  const n = samples.length / 3;
  const N = w * h;
  const results = {}, border = {};
  let suggested = 1;
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (let k = 1; k <= kMax; k++) {
    if (n < k) break;
    const r = kmeans(samples, k, 14, lcg(7 + k));
    // drop empty clusters
    const keep = r.counts.map((c, i) => i).filter(i => r.counts[i] > 0);
    r.centers = keep.map(i => r.centers[i]); r.counts = keep.map(i => r.counts[i]);
    results[k] = r;
    const C = r.centers, m = C.length;
    // every pixel -> nearest colour, for the edge count and the shape tests below
    const lab = new Int16Array(N), cnt = new Array(m).fill(0);
    for (let i = 0; i < N; i++) {
      if (rgba[i * 4 + 3] < 128) { lab[i] = -1; continue; }
      let b = 0, bd = Infinity;
      for (let j = 0; j < m; j++) { const d = (rgba[i * 4] - C[j][0]) ** 2 + (rgba[i * 4 + 1] - C[j][1]) ** 2 + (rgba[i * 4 + 2] - C[j][2]) ** 2; if (d < bd) { bd = d; b = j; } }
      lab[i] = b; cnt[b]++;
    }
    // which colour owns the image border (likely the fabric / background)
    const bc = new Array(m).fill(0);
    let bt = 0;
    const visit = i => { if (lab[i] < 0) bt++; else bc[lab[i]]++; };
    for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { visit(y * w); visit(y * w + w - 1); }
    const bTotal = 2 * w + 2 * (h - 2);
    border[k] = { counts: bc, transparent: bt, total: bTotal };
    if (k === 1) continue;
    let bgi = -1;
    if (bt < bTotal * 0.5) { const mx = Math.max(...bc); if (mx > bTotal * 0.3) bgi = bc.indexOf(mx); }
    // shares are measured against the design itself, not the background around it
    let fgN = 0;
    for (let j = 0; j < m; j++) if (j !== bgi) fgN += cnt[j];
    fgN = Math.max(1, fgN);
    // how solid each colour is: the share of its pixels whose 4 neighbours are the same colour.
    // Soft edges (anti-aliasing) are 1-2 px slivers and score near 0.
    const core = new Array(m).fill(0);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, L = lab[i];
      if (L >= 0 && lab[i - 1] === L && lab[i + 1] === L && lab[i - w] === L && lab[i + w] === L) core[L]++;
    }
    let ok = m === k;
    for (let i = 0; i < m && ok; i++) {
      for (let j = i + 1; j < m && ok; j++) if (dist(C[i], C[j]) < 40) ok = false;
      if (i === bgi || !ok) continue;
      // tiny colours are usually noise, but a clearly different one (small text, an eye) counts from less
      let near = Infinity;
      for (let j = 0; j < m; j++) if (j !== i) near = Math.min(near, dist(C[i], C[j]));
      if (cnt[i] / fgN < (near > 90 ? 0.006 : 0.02) || cnt[i] < 12) { ok = false; break; }
      // blend test: a thin colour sitting on the line between two others is anti-aliasing
      const solid = core[i] / Math.max(1, cnt[i]);
      if (solid >= 0.15) continue;
      for (let a = 0; a < m && ok; a++) for (let b = a + 1; b < m && ok; b++) {
        if (a === i || b === i) continue;
        const ab = [C[b][0] - C[a][0], C[b][1] - C[a][1], C[b][2] - C[a][2]];
        const ai = [C[i][0] - C[a][0], C[i][1] - C[a][1], C[i][2] - C[a][2]];
        const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
        const t = (ab[0] * ai[0] + ab[1] * ai[1] + ab[2] * ai[2]) / L2;
        const px = ai[0] - t * ab[0], py = ai[1] - t * ab[1], pz = ai[2] - t * ab[2];
        if (t > 0.1 && t < 0.9 && Math.hypot(px, py, pz) < Math.max(30, 0.25 * Math.sqrt(L2))) ok = false;
      }
    }
    if (ok) suggested = k;
  }
  return { results, suggested: Math.max(1, suggested), border, transparentShare: transparent / Math.max(1, total) };
}

/* ------------------------------------------------------------ main: image -> commands */
/* params: rgba (working size W x H, already resized), mmpx, colors: [{rgb:[r,g,b], stitch:bool, thread:int}]
   order: array of colour indices in stitch order, angle, density (mm), satinMax (mm) */
/* Each pixel -> index of the nearest colour (or -1 for transparent), with
   anti-aliasing fringes and tiny specks handed to their neighbours. */
function labelImage(rgba, W, H, mmpx, C, blurPx, skip) {
  const N = W * H;
  let img = new Float32Array(N * 3);
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) { img[i * 3] = rgba[i * 4]; img[i * 3 + 1] = rgba[i * 4 + 1]; img[i * 3 + 2] = rgba[i * 4 + 2]; alpha[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0; }
  if ((blurPx | 0) > 0) img = boxBlur3(img, W, H, blurPx | 0);
  const labels = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    if (!alpha[i]) { labels[i] = -1; continue; }
    let b = 0, bd = Infinity;
    for (let j = 0; j < C.length; j++) {
      if (skip && skip[j]) continue;      // background shades: their pixels go to the nearest remaining colour
      const d = (img[i * 3] - C[j][0]) ** 2 + (img[i * 3 + 1] - C[j][1]) ** 2 + (img[i * 3 + 2] - C[j][2]) ** 2;
      if (d < bd) { bd = d; b = j; }
    }
    labels[i] = b;
  }
  const unassigned = new Uint8Array(N);
  const fringeR = 0.2 / mmpx, minArea = 0.5 / (mmpx * mmpx);
  for (let j = -1; j < C.length; j++) {
    const M = new Uint8Array(N);
    let cnt = 0;
    for (let i = 0; i < N; i++) if (labels[i] === j) { M[i] = 1; cnt++; }
    if (!cnt) continue;
    const kept = openMask(M, W, H, fringeR);
    const { lab, comps } = labelComponents(kept, W, H);
    const small = new Set(comps.filter(c => c.count < minArea).map(c => c.id));
    for (let i = 0; i < N; i++) if (M[i] && (!kept[i] || small.has(lab[i]))) unassigned[i] = 1;
  }
  propagateLabels(labels, unassigned, W, H);
  return labels;
}

/* Remove areas: the background that touches the picture's edge (opts.removeEdge) and any
   areas the person tapped (opts.seeds, as [u, v] fractions of width and height).
   A removed area is the whole connected patch of one colour; it becomes transparent. */
function applyRemovals(labels, W, H, opts) {
  if (!opts) return -1;
  const N = W * H, q = new Int32Array(N);
  const flood = (seeds, L) => {
    let h = 0, t = 0;
    for (const i of seeds) if (labels[i] === L) { labels[i] = -1; q[t++] = i; }
    while (h < t) {
      const i = q[h++], x = i % W, y = (i / W) | 0;
      if (x > 0 && labels[i - 1] === L) { labels[i - 1] = -1; q[t++] = i - 1; }
      if (x < W - 1 && labels[i + 1] === L) { labels[i + 1] = -1; q[t++] = i + 1; }
      if (y > 0 && labels[i - W] === L) { labels[i - W] = -1; q[t++] = i - W; }
      if (y < H - 1 && labels[i + W] === L) { labels[i + W] = -1; q[t++] = i + W; }
    }
  };
  let edgeLabel = -1;
  if (opts.removeEdge) {
    const border = [];
    for (let x = 0; x < W; x++) { border.push(x, (H - 1) * W + x); }
    for (let y = 1; y < H - 1; y++) { border.push(y * W, y * W + W - 1); }
    const cnt = new Map();
    for (const i of border) if (labels[i] >= 0) cnt.set(labels[i], (cnt.get(labels[i]) || 0) + 1);
    let best = -1, bc = 0;
    for (const [L, c] of cnt) if (c > bc) { bc = c; best = L; }
    if (best >= 0 && bc >= 0.3 * border.length) { edgeLabel = best; flood(border.filter(i => labels[i] === best), best); }
  }
  // opts.edgeOf: remove that colour where it touches the picture's edge (the canvas border or a
  // transparent area around a rotated picture), keeping it where it sits inside the design
  if (opts.edgeOf != null && opts.edgeOf >= 0) {
    const L = opts.edgeOf, seeds = [];
    for (let i = 0; i < N; i++) {
      if (labels[i] !== L) continue;
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || labels[i - 1] === -1 || labels[i + 1] === -1 || labels[i - W] === -1 || labels[i + W] === -1) seeds.push(i);
    }
    flood(seeds, L);
  }
  for (const [u, v] of opts.seeds || []) {
    const x = Math.max(0, Math.min(W - 1, Math.round(u * (W - 1)))), y = Math.max(0, Math.min(H - 1, Math.round(v * (H - 1))));
    const i = y * W + x;
    if (labels[i] >= 0) flood([i], labels[i]);
  }
  return edgeLabel;
}

/* Lines thinner than minMM can't be sewn: they break up or vanish. Thicken them to
   about minMM, growing only into fabric (never over another stitched colour). Wide
   shapes keep their outline; only genuinely thin parts (lines, small dots, tips) grow. */
function boldThinLines(labels, W, H, mmpx, stitched, minMM) {
  const r = minMM / 2 / mmpx;
  if (!(r >= 1)) return 0;
  const N = W * H;
  let grown = 0;
  for (const L of stitched) {
    const M = new Uint8Array(N);
    let cnt = 0;
    for (let i = 0; i < N; i++) if (labels[i] === L) { M[i] = 1; cnt++; }
    if (!cnt) continue;
    const D = distIn(M, W, H);
    const nearWide = dilate(openMask(M, W, H, r, D), W, H, 0.6 * r);
    // centre line of the thin parts: local maxima of the distance to the edge
    const seeds = new Uint8Array(N);
    let ns = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = D[i];
      if (!M[i] || d >= r || nearWide[i]) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && D[yy * W + xx] > d) { top = false; break; }
      }
      if (top) { seeds[i] = 1; ns++; }
    }
    if (!ns) continue;
    const grow = dilate(seeds, W, H, r);
    for (let i = 0; i < N; i++) if (grow[i] && !stitched.has(labels[i])) { labels[i] = L; grown++; }
  }
  return grown;
}

/* Which colours are background: the colour that owns the picture's edge, other colours
   that also cover a good part of the edge (gradients, vignettes), and darker or lighter
   shades of the background that hug the design's edges (drop shadows, glows, the dark
   blue left in narrow gaps). Returns colour indices for analyzeColors' result k. */
function backgroundSet(an, k, rgba, w, h) {
  const r = an.results[k], b = an.border[k];
  if (!r || !b || r.centers.length < 2 || b.transparent >= b.total * 0.5) return [];
  const C = r.centers, n = C.length;
  const m = Math.max(...b.counts);
  if (m <= b.total * 0.3) return [];
  const bg = b.counts.indexOf(m);
  const angle = (p, q) => {
    const a = Math.hypot(...p) || 1, c = Math.hypot(...q) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (a * c)))) * 180 / Math.PI;
  };
  const chroma = c => Math.max(...c) - Math.min(...c);
  const similar = j => {
    const p = C[j], q = C[bg];
    if (chroma(q) < 30) return chroma(p) < 30;                 // grey/white background: grey shades
    return chroma(p) >= 18 && angle(p, q) < 14;                 // same hue, lighter or darker
  };
  const set = new Set([bg]);
  for (let j = 0; j < n; j++) {
    if (j === bg) continue;
    const share = b.counts[j] / b.total;
    if (share >= 0.25 || (share >= 0.05 && similar(j))) set.add(j);
  }
  // shades that hug the design: label the analysis picture and look around each pixel
  const N = w * h, lab = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    if (rgba[i * 4 + 3] < 128) { lab[i] = -1; continue; }
    let bi = 0, bd = Infinity;
    for (let j = 0; j < n; j++) { const d = (rgba[i * 4] - C[j][0]) ** 2 + (rgba[i * 4 + 1] - C[j][1]) ** 2 + (rgba[i * 4 + 2] - C[j][2]) ** 2; if (d < bd) { bd = d; bi = j; } }
    lab[i] = bi;
  }
  const area = new Array(n).fill(0), core = new Array(n).fill(0);
  for (let i = 0; i < N; i++) if (lab[i] >= 0) area[lab[i]]++;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, L = lab[i];
    if (L >= 0 && lab[i - 1] === L && lab[i + 1] === L && lab[i - w] === L && lab[i + w] === L) core[L]++;
  }
  // soft edges are slivers: almost none of their pixels are surrounded by the same colour
  const sliver = j => core[j] / Math.max(1, area[j]) < 0.15;
  const rad = Math.max(3, Math.round(Math.max(w, h) / 70));
  // a near shade of the background (lighting, gradient) is background wherever it is
  for (let j = 0; j < n; j++) if (!set.has(j) && similar(j) && Math.hypot(C[j][0] - C[bg][0], C[j][1] - C[bg][1], C[j][2] - C[bg][2]) < 70) set.add(j);
  // soft edge between a background colour and a design colour (anti-aliasing): sits on the line between them
  const blend = j => {
    for (const g of set) for (let f = 0; f < n; f++) {
      if (f === j || set.has(f)) continue;
      const P = C[g], Q = C[f], X = C[j];
      const ab = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]], ax = [X[0] - P[0], X[1] - P[1], X[2] - P[2]];
      const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = (ab[0] * ax[0] + ab[1] * ax[1] + ab[2] * ax[2]) / L2;
      const off = Math.hypot(ax[0] - t * ab[0], ax[1] - t * ab[1], ax[2] - t * ab[2]);
      if (t > 0.1 && t < 0.9 && off < Math.max(30, 0.25 * Math.sqrt(L2))) return true;
    }
    return false;
  };
  // darker shades (shadows) and soft edges go too: they hug the design's edges, and each
  // patch of them also touches the background (a shadow or a gap opens onto it). Text in a
  // similar colour sitting inside a design shape doesn't touch the background, so it stays.
  for (let pass = 0, more = true; pass < 4 && more; pass++) {
    more = false;
    for (let j = 0; j < n; j++) {
      const isBlend = sliver(j) && blend(j);
      if (set.has(j) || !(similar(j) || isBlend) || !area[j] || area[j] > 0.6 * area[bg]) continue;
      const fg = new Uint8Array(N), bgm = new Uint8Array(N), M = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const L = lab[i];
        if (L === j) M[i] = 1; else if (L >= 0) { if (set.has(L)) bgm[i] = 1; else fg[i] = 1; }
      }
      const near = dilate(fg, w, h, rad);
      let hug = 0;
      for (let i = 0; i < N; i++) if (M[i] && near[i]) hug++;
      if (hug / area[j] < 0.5) continue;
      // a soft edge is safe to drop: its pixels go to the nearest colour that is left
      if (isBlend) { set.add(j); more = true; continue; }
      // real background areas only, not the 1-2 px soft edges that look like background
      const touch = dilate(openMask(bgm, w, h, 1.5), w, h, 1.5);
      const { lab: cl, comps } = labelComponents(M, w, h);
      const hit = new Uint8Array(comps.length + 1);
      for (let i = 0; i < N; i++) if (M[i] && touch[i]) hit[cl[i]] = 1;
      let onBg = 0;
      for (const c of comps) if (hit[c.id]) onBg += c.count;
      if (onBg / area[j] >= 0.5) { set.add(j); more = true; }
    }
  }
  return [...set];
}

/* Colours marked merge (left-out shades of the background) are folded into whatever is
   nearest, usually the main background, so thin shadows and soft edges don't become
   slivers of their own that the cleanup then hands to the design. */
function mergeSkips(colors) {
  const skip = colors.map(c => !!c.merge && !c.stitch);
  return skip.some(Boolean) && skip.some(v => !v) ? skip : null;
}

/* A logo as a flat, editable layer: stitched colours become their thread colour,
   fabric colours and transparent areas become transparent. Returns RGBA bytes. */
function logoToLayer(rgba, W, H, mmpx, colors, blurPx, removal, opts) {
  const labels = labelImage(rgba, W, H, mmpx, colors.map(c => c.rgb), blurPx, mergeSkips(colors));
  applyRemovals(labels, W, H, removal);
  if (opts && opts.boldMM) boldThinLines(labels, W, H, mmpx, new Set(colors.map((c, j) => c.stitch ? j : -1).filter(j => j >= 0)), opts.boldMM);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const c = labels[i] >= 0 ? colors[labels[i]] : null;
    if (!c || !c.stitch) continue;
    out[i * 4] = (c.thread >> 16) & 255; out[i * 4 + 1] = (c.thread >> 8) & 255; out[i * 4 + 2] = c.thread & 255; out[i * 4 + 3] = 255;
  }
  return out;
}

function digitize(p, progress) {
  const { W, H, mmpx } = p;
  const say = progress || (() => {});
  const N = W * H;
  say('colors');
  const labels = labelImage(p.rgba, W, H, mmpx, p.colors.map(c => c.rgb), p.blurPx, mergeSkips(p.colors));
  applyRemovals(labels, W, H, { removeEdge: !!p.removeEdge, seeds: p.removeSeeds || [] });

  const stitched = new Set(p.order.filter(j => p.colors[j].stitch));
  if (p.boldMM) boldThinLines(labels, W, H, mmpx, stitched, p.boldMM);
  // 4. keep narrow gaps of fabric open (>= ~1 mm) so the stitches don't close them up
  const B = new Uint8Array(N);
  let hasB = false;
  for (let i = 0; i < N; i++) if (!stitched.has(labels[i])) { B[i] = 1; hasB = true; }
  if (hasB) {
    const narrow = andNot(B, openMask(B, W, H, 0.5 / mmpx));
    const widen = dilate(narrow, W, H, 0.15 / mmpx);
    for (let i = 0; i < N; i++) if (widen[i] && !B[i]) labels[i] = -1;
  }

  // 5. digitize each stitched colour
  const b = new Builder();
  const threads = [], used = [];
  const order = p.order.filter(j => stitched.has(j));
  let cur = [0, 0];
  const summary = [];
  order.forEach((j, oi) => {
    say('color ' + (oi + 1) + '/' + order.length);
    const M = new Uint8Array(N);
    let cnt = 0;
    for (let i = 0; i < N; i++) if (labels[i] === j) { M[i] = 1; cnt++; }
    if (!cnt) return;
    const later = new Uint8Array(N);
    for (const k of order.slice(oi + 1)) for (let i = 0; i < N; i++) if (labels[i] === k) later[i] = 1;
    const R = or(M, and(dilate(M, W, H, 0.25 / mmpx), later));
    const D = distIn(R, W, H);
    const half = p.satinMax / 2 / mmpx;
    const thick = openMask(R, W, H, half, D);
    const fillMask = and(dilate(thick, W, H, 0.3 / mmpx), R);
    const inner = erode(thick, W, H, 0.4 / mmpx);
    const sk = thin(R, W, H);
    const narrowSk = new Uint8Array(N);
    let nCount = 0;
    for (let i = 0; i < N; i++) if (sk[i] && 2 * D[i] * mmpx < p.satinMax && !inner[i]) { narrowSk[i] = 1; nCount++; }

    if (threads.length) b.colorChange();
    threads.push(p.colors[j].thread);
    used.push(j);
    // travel map: 2 = under a later colour (hidden), 1 = this colour, 0 = not allowed
    const tm = new Uint8Array(N);
    const laterIn = erode(later, W, H, 0.15 / mmpx);
    for (let i = 0; i < N; i++) tm[i] = laterIn[i] ? 2 : (R[i] ? 1 : 0);
    b.travel = { mask: tm, W, H, mmpx };
    let st0 = b.cmds.length;
    if (nCount) {
      const blocks = networkBlocks(narrowSk, D, W, H, mmpx, { pruneMM: 1.2, minW: 0.9, maxW: p.satinMax, extraW: 0, pull: p.pull === undefined ? 0.2 : p.pull, satinSpacing: p.satinSpacing || 0.4, underlay: p.underlay || 'normal' });
      const r = orderNetworks(blocks, cur);
      for (const s of r.seqs) b.points(s);
      if (r.seqs.length) cur = b.cur;
    }
    const { lab, comps } = labelComponents(fillMask, W, H);
    const left = comps.filter(c => c.count * mmpx * mmpx > 0.6);
    while (left.length) {
      left.sort((c1, c2) => boxDist(c1, cur, mmpx) - boxDist(c2, cur, mmpx));
      const c = left.shift();
      const r = fillComponent(fillMask, W, H, c, lab, mmpx, { angle: p.angle, density: p.density, stitchLen: 3.5, underlay: p.underlay || 'normal', pullMM: p.fillPull || 0 }, cur, laterIn);
      b.seq(r.seq);
      cur = b.cur || cur;
    }
    summary.push({ color: j, commands: b.cmds.length - st0 });
  });
  if (b.cmds.length) b.end();
  // basting box: a running stitch around everything, sewn first in its own colour stop,
  // to hold fabric and stabilizer together; it is pulled out afterwards
  let basted = false;
  if (p.basting && b.cmds.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of b.cmds) if (c[2] === STITCH) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }
    const m = 2.5;
    x0 -= m; y0 -= m; x1 += m; y1 += m;
    const bb = new Builder();
    bb.points(runPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], 4.0));
    bb.colorChange();
    b.cmds = bb.cmds.concat(b.cmds);
    threads.unshift(0xa8a8a8); used.unshift(-1);
    basted = true;
  }
  const res = finish(b, threads, summary);
  res.colorsUsed = used;
  res.basting = basted;
  return res;
}
function boxDist(c, p, mmpx) {
  const x = p[0] / mmpx, y = p[1] / mmpx;
  const dx = Math.max(c.minx - x, 0, x - c.maxx), dy = Math.max(c.miny - y, 0, y - c.maxy);
  return Math.hypot(dx, dy);
}
function boxBlur3(src, W, H, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[(y * W + Math.min(W - 1, Math.max(0, x))) * 3 + c];
    for (let x = 0; x < W; x++) {
      tmp[(y * W + x) * 3 + c] = acc / n;
      const xo = Math.max(0, x - r), xi = Math.min(W - 1, x + r + 1);
      acc += src[(y * W + xi) * 3 + c] - src[(y * W + xo) * 3 + c];
    }
  }
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[(Math.min(H - 1, Math.max(0, y)) * W + x) * 3 + c];
    for (let y = 0; y < H; y++) {
      out[(y * W + x) * 3 + c] = acc / n;
      const yo = Math.max(0, y - r), yi = Math.min(H - 1, y + r + 1);
      acc += tmp[(yi * W + x) * 3 + c] - tmp[(yo * W + x) * 3 + c];
    }
  }
  return out;
}
function propagateLabels(labels, un, W, H) {
  const N = W * H, q = new Int32Array(N);
  let h = 0, t = 0;
  for (let i = 0; i < N; i++) {
    if (un[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && un[i - 1]) || (x < W - 1 && un[i + 1]) || (y > 0 && un[i - W]) || (y < H - 1 && un[i + W])) q[t++] = i;
  }
  while (h < t) {
    const i = q[h++];
    const x = i % W, y = (i / W) | 0;
    const nb = [];
    if (x > 0) nb.push(i - 1); if (x < W - 1) nb.push(i + 1); if (y > 0) nb.push(i - W); if (y < H - 1) nb.push(i + W);
    for (const j of nb) if (un[j]) { un[j] = 0; labels[j] = labels[i]; q[t++] = j; }
  }
}

/* shift so every coordinate is >= 0 (Brother machines treat the start point as the
   design's top-left corner), convert to 0.1 mm integers, count things */
function finish(b, threads, summary) {
  let minx = Infinity, miny = Infinity;
  for (const c of b.cmds) { if (c[0] < minx) minx = c[0]; if (c[1] < miny) miny = c[1]; }
  if (!isFinite(minx)) { minx = 0; miny = 0; }
  const cmds = b.cmds.map(c => [Math.round((c[0] - minx) * 10), Math.round((c[1] - miny) * 10), c[2]]);
  let maxx = 0, maxy = 0, stitches = 0, colorChanges = 0, jumps = 0;
  for (const c of cmds) {
    if (c[0] > maxx) maxx = c[0]; if (c[1] > maxy) maxy = c[1];
    if (c[2] === STITCH) stitches++; else if (c[2] === COLOR_CHANGE) colorChanges++; else if (c[2] === JUMP) jumps++;
  }
  return { cmds, threads, width: maxx / 10, height: maxy / 10, stitches, colorChanges, trims: b.trims, jumps, summary, offset: [minx, miny] };
}

/* ------------------------------------------------------------ PES / PEC writer
   Port of pyembroidery's PES v1 + PEC writer (the format your Brother machine read). */
const PEC_PALETTE = [null, 0x0e1f7c, 0x0a55a3, 0x008777, 0x4b6baf, 0xed171f, 0xd15c00, 0x913697, 0xe49acb, 0x915fac, 0x9ed67d, 0xe8a900, 0xfeba35, 0xffff00, 0x70bc1f, 0xba9800, 0xa8a8a8, 0x7d6f00, 0xffffb3, 0x4f5556, 0x000000, 0x0b3d91, 0x770176, 0x293133, 0x2a1301, 0xf64a8a, 0xb27624, 0xfcbbc5, 0xfe370f, 0xf0f0f0, 0x6a1c8a, 0xa8ddc4, 0x2584bb, 0xfeb343, 0xfff36b, 0xd0a660, 0xd15400, 0x66ba49, 0x134a46, 0x878787, 0xd8ccc6, 0x435607, 0xfdd9de, 0xf993bc, 0x003822, 0xb2afd4, 0x686ab0, 0xefe3b9, 0xf73866, 0xb54b64, 0x132b1a, 0xc70156, 0xfe9e32, 0xa8deeb, 0x00673e, 0x4e2990, 0x2f7e20, 0xffcccc, 0xffd911, 0x095ba6, 0xf0f970, 0xe3f35b, 0xff9900, 0xfff08d, 0xffc8c8];
const PEC_NAMES = [null, 'Prussian Blue', 'Blue', 'Teal Green', 'Cornflower Blue', 'Red', 'Reddish Brown', 'Magenta', 'Light Lilac', 'Lilac', 'Mint Green', 'Deep Gold', 'Orange', 'Yellow', 'Lime Green', 'Brass', 'Silver', 'Russet Brown', 'Cream Brown', 'Pewter', 'Black', 'Ultramarine', 'Royal Purple', 'Dark Gray', 'Dark Brown', 'Deep Rose', 'Light Brown', 'Salmon Pink', 'Vermilion', 'White', 'Violet', 'Seacrest', 'Sky Blue', 'Pumpkin', 'Cream Yellow', 'Khaki', 'Clay Brown', 'Leaf Green', 'Peacock Blue', 'Gray', 'Warm Gray', 'Dark Olive', 'Flesh Pink', 'Pink', 'Deep Green', 'Lavender', 'Wisteria Violet', 'Beige', 'Carmine', 'Amber Red', 'Olive Green', 'Dark Fuchsia', 'Tangerine', 'Light Blue', 'Emerald Green', 'Purple', 'Moss Green', 'Flesh Pink', 'Harvest Gold', 'Electric Blue', 'Lemon Yellow', 'Fresh Green', 'Orange', 'Cream Yellow', 'Applique'];
function colorDist(c1, c2) {
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const rm = Math.round((r1 + r2) / 2);
  const r = r1 - r2, g = g1 - g2, b = b1 - b2;
  return (((512 + rm) * r * r) >> 8) + 4 * g * g + (((767 - rm) * b * b) >> 8);
}
function nearestIndex(color, values) {
  let best = null, bd = Infinity;
  values.forEach((t, i) => { if (t === null || t === undefined) return; const d = colorDist(color, t); if (d <= bd) { bd = d; best = i; } });
  return best;
}
function brotherName(color) { return PEC_NAMES[nearestIndex(color, PEC_PALETTE)]; }

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.pos = 0; }
  ensure(n) { if (this.pos + n > this.buf.length) { let L = this.buf.length; while (this.pos + n > L) L *= 2; const nb = new Uint8Array(L); nb.set(this.buf); this.buf = nb; } }
  u8(v) { this.ensure(1); this.buf[this.pos++] = v & 255; }
  bytes(arr) { this.ensure(arr.length); for (const v of arr) this.buf[this.pos++] = v & 255; }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  u24(v) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16); }
  u32(v) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16); this.u8(v >>> 24); }
  f32(v) { const b = new Uint8Array(new Float32Array([v]).buffer); this.bytes(b); }
  str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  patch16(at, v) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; }
  patch24(at, v) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; this.buf[at + 2] = (v >> 16) & 255; }
  patch32(at, v) { this.patch16(at, v & 0xffff); this.patch16(at + 2, (v >>> 16) & 0xffff); }
  result() { return this.buf.slice(0, this.pos); }
}
const PEC_BLANK = [0, 0, 0, 0, 0, 0, 240, 255, 255, 255, 255, 15, 8, 0, 0, 0, 0, 16, 4, 0, 0, 0, 0, 32].concat(
  [].concat(...Array(30).fill([2, 0, 0, 0, 0, 64])), [4, 0, 0, 0, 0, 32, 8, 0, 0, 0, 0, 16, 240, 255, 255, 255, 255, 15, 0, 0, 0, 0, 0, 0]);

function bounds(cmds) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const s of cmds) { if (s[0] > c) c = s[0]; if (s[0] < a) a = s[0]; if (s[1] > d) d = s[1]; if (s[1] < b) b = s[1]; }
  return [a, b, c, d];
}
function drawScaled(ext, pts, g, stride, buffer) {
  if (buffer === undefined) buffer = 5;
  let dw = ext[2] - ext[0], dh = ext[3] - ext[1];
  if (dw === 0) dw = 1; if (dh === 0) dh = 1;
  const gw = stride * 8, gh = g.length / stride;
  const scale = Math.min((gw - buffer) / dw, (gh - buffer) / dh);
  const cx = (ext[2] + ext[0]) / 2, cy = (ext[3] + ext[1]) / 2;
  const tx = -cx * scale + gw / 2, ty = -cy * scale + gh / 2;
  for (const p of pts) {
    const x = Math.floor(p[0] * scale + tx), y = Math.floor(p[1] * scale + ty);
    let idx = y * stride + Math.trunc(x / 8);
    if (idx < 0) idx += g.length;
    if (idx < 0 || idx >= g.length) continue;
    g[idx] |= 1 << (((x % 8) + 8) % 8);
  }
}
function pecValue(w, v, long, flag) {
  if (!long && -64 < v && v < 63) w.u8(v & 0x7f);
  else { v &= 0x0fff; v |= 0x8000; v |= flag << 8; w.u8((v >> 8) & 255); w.u8(v & 255); }
}
function pecEncode(w, cmds) {
  let colorTwo = true, jumping = true, init = true, xx = 0, yy = 0;
  for (const [x, y, c] of cmds) {
    const dx = x - xx, dy = y - yy;
    xx += dx; yy += dy;
    if (c === STITCH) {
      if (jumping) { if (dx !== 0 && dy !== 0) { pecValue(w, 0); pecValue(w, 0); } jumping = false; }
      pecValue(w, dx); pecValue(w, dy);
    } else if (c === JUMP) {
      jumping = true;
      const flag = init ? 0x10 : 0x20;
      pecValue(w, dx, true, flag); pecValue(w, dy, true, flag);
    } else if (c === COLOR_CHANGE) {
      if (jumping) { pecValue(w, 0); pecValue(w, 0); jumping = false; }
      w.u8(0xfe); w.u8(0xb0); w.u8(colorTwo ? 2 : 1);
      colorTwo = !colorTwo;
    } else if (c === END) { w.u8(0xff); break; }
    init = false;
  }
}
function writePec(w, cmds, threads, name) {
  const ext = bounds(cmds);
  const label = ('LA:' + (name.slice(0, 8) + '                ').slice(0, Math.max(16, name.slice(0, 8).length)) + '\r');
  w.str(label);
  w.bytes([32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 0xff, 0x00]);
  w.u8(6); w.u8(38);
  // unique palette
  const pal = PEC_PALETTE.slice();
  const chart = new Array(PEC_PALETTE.length).fill(null);
  const uniq = [];
  for (const t of threads) if (!uniq.includes(t)) uniq.push(t);
  for (const t of uniq) { const idx = nearestIndex(t, pal); if (idx === null) break; pal[idx] = null; chart[idx] = t; }
  const list = threads.map(t => nearestIndex(t, chart));
  const count = list.length;
  if (count) { w.bytes(Array(12).fill(32)); w.bytes([count - 1].concat(list)); }
  else w.bytes([0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff]);
  for (let i = count; i < 463; i++) w.u8(0x20);
  // stitch block
  const start = w.pos;
  w.bytes([0, 0]); w.u24(0); w.bytes([0x31, 0xff, 0xf0]);
  w.u16(Math.round(ext[2] - ext[0])); w.u16(Math.round(ext[3] - ext[1]));
  w.u16(0x1e0); w.u16(0x1b0);
  pecEncode(w, cmds);
  w.patch24(start + 2, w.pos - start);
  // icons: whole design, then one per colour
  const g = PEC_BLANK.slice();
  for (const s of cmds) if (s[2] === STITCH) drawScaled(ext, [s], g, 6, 4);
  w.bytes(g);
  let block = [];
  const flush = () => { const gg = PEC_BLANK.slice(); drawScaled(ext, block.filter(s => s[2] === STITCH), gg, 6); w.bytes(gg); block = []; };
  cmds.forEach(s => { block.push(s); if (s[2] === COLOR_CHANGE) flush(); });
  if (block.length) flush();
  return list;
}
function writePES(cmds, threads, name) {
  name = name || 'Untitled';
  const w = new ByteWriter();
  w.str('#PES0001');
  const pecAt = w.pos; w.u32(0);
  const ext = bounds(cmds);
  const cx = (ext[2] + ext[0]) / 2, cy = (ext[3] + ext[1]) / 2;
  const left = ext[0] - cx, top = ext[1] - cy, right = ext[2] - cx, bottom = ext[3] - cy;
  w.u16(1); w.u16(1); w.u16(1);
  w.u16(0xffff); w.u16(0);
  // CEmbOne
  w.u16(7); w.str('CEmbOne');
  const width = right - left, height = bottom - top;
  for (let i = 0; i < 8; i++) w.u16(0);
  const tx = 350 + 1300 / 2 - width / 2, ty = 100 + height + 1800 / 2 - height / 2;
  w.f32(1); w.f32(0); w.f32(0); w.f32(1); w.f32(tx); w.f32(ty);
  w.u16(1); w.u16(0); w.u16(0); w.u16(Math.trunc(width)); w.u16(Math.trunc(height));
  w.bytes([0, 0, 0, 0, 0, 0, 0, 0]);
  const secAt = w.pos; w.u16(0);
  w.u16(0xffff); w.u16(0);
  // CSewSeg
  w.u16(7); w.str('CSewSeg');
  const adjX = left + cx, adjY = bottom + cy;
  let colorIndex = 0;
  let code = nearestIndex(threads[colorIndex++] ?? 0, PEC_PALETTE);
  let sx = 0, sy = 0, section = 0, prevCode = -1, flag = -1;
  const colorlog = [];
  // command blocks: consecutive entries with the same command
  const blocks = [];
  for (const s of cmds) {
    if (blocks.length && blocks[blocks.length - 1][0][2] === s[2]) blocks[blocks.length - 1].push(s);
    else blocks.push([s]);
  }
  for (const blk of blocks) {
    const c = blk[0][2];
    let seg, f;
    if (c === JUMP) { const last = blk[blk.length - 1]; seg = [[sx - adjX, sy - adjY], [last[0] - adjX, last[1] - adjY]]; f = 1; }
    else if (c === COLOR_CHANGE) { code = nearestIndex(threads[colorIndex++] ?? 0, PEC_PALETTE); continue; }
    else if (c === STITCH) { seg = blk.map(s => { sx = s[0]; sy = s[1]; return [s[0] - adjX, s[1] - adjY]; }); f = 0; }
    else continue;
    if (flag !== -1) w.u16(0x8003);
    flag = f;
    if (prevCode !== code) { colorlog.push([section, code]); prevCode = code; }
    w.u16(f); w.u16(code); w.u16(seg.length);
    for (const [x, y] of seg) { w.u16(Math.trunc(x)); w.u16(Math.trunc(y)); }
    section++;
  }
  w.u16(colorlog.length);
  for (const [s, c] of colorlog) { w.u16(s); w.u16(c); }
  w.patch16(secAt, section);
  w.u16(0); w.u16(0);
  w.patch32(pecAt, w.pos);
  writePec(w, cmds, threads, name);
  return w.result();
}

/* ------------------------------------------------------------ zip (stored) */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) {
  const w = new ByteWriter();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const central = [];
  for (const f of files) {
    const crc = crc32(f.data), off = w.pos;
    w.u32(0x04034b50); w.u16(20); w.u16(0); w.u16(0); w.u16(time); w.u16(date);
    w.u32(crc); w.u32(f.data.length); w.u32(f.data.length); w.u16(f.name.length); w.u16(0);
    w.str(f.name); w.bytes(f.data);
    central.push({ f, crc, off });
  }
  const cdStart = w.pos;
  for (const { f, crc, off } of central) {
    w.u32(0x02014b50); w.u16(20); w.u16(20); w.u16(0); w.u16(0); w.u16(time); w.u16(date);
    w.u32(crc); w.u32(f.data.length); w.u32(f.data.length); w.u16(f.name.length);
    w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u32(0); w.u32(off); w.str(f.name);
  }
  const cdSize = w.pos - cdStart;
  w.u32(0x06054b50); w.u16(0); w.u16(0); w.u16(files.length); w.u16(files.length); w.u32(cdSize); w.u32(cdStart); w.u16(0);
  return w.result();
}

/* ------------------------------------------------------------ reading .pes files
   Every PES version carries a PEC block (the part Brother machines read), so that is what
   we read. Returns stitches in 0.1 mm with the design's own thread colours. */
function readPES(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = String.fromCharCode(...u8.subarray(0, 8));
  let p0;
  if (sig === '#PEC0001') p0 = 8;
  else if (sig.startsWith('#PES')) p0 = (u8[8] | (u8[9] << 8) | (u8[10] << 16) | (u8[11] << 24)) >>> 0;
  else throw new Error('not-pes');
  if (!(p0 > 0) || p0 + 532 > u8.length) throw new Error('broken-pes');
  const label = String.fromCharCode(...u8.subarray(p0 + 3, p0 + 19)).replace(/[^\x20-\x7e]/g, '').trim();
  const cc = u8[p0 + 48];
  const count = cc === 0xff ? 1 : cc + 1;
  const colorIdx = Array.from(u8.subarray(p0 + 49, p0 + 49 + count));
  const blockLen = u8[p0 + 514] | (u8[p0 + 515] << 8) | (u8[p0 + 516] << 16);
  const end = Math.min(u8.length, p0 + 512 + blockLen);
  const s7 = b => (b > 63 ? b - 128 : b);
  const s12 = b => { b &= 0xfff; return b > 0x7ff ? b - 0x1000 : b; };
  const cmds = [];
  let i = p0 + 528, x = 0, y = 0;
  while (i < end) {
    const v1 = u8[i], v2 = u8[i + 1];
    if (v1 === 0xff || v2 === undefined) break;
    if (v1 === 0xfe && v2 === 0xb0) { cmds.push([x, y, COLOR_CHANGE]); i += 3; continue; }
    let jump = false, trim = false, dx, dy;
    if (v1 & 0x80) { if (v1 & 0x20) trim = true; if (v1 & 0x10) jump = true; dx = s12((v1 << 8) | v2); i += 2; }
    else { dx = s7(v1); i += 1; }
    const w1 = u8[i];
    if (w1 === undefined) break;
    if (w1 & 0x80) { if (w1 & 0x20) trim = true; if (w1 & 0x10) jump = true; dy = s12((w1 << 8) | u8[i + 1]); i += 2; }
    else { dy = s7(w1); i += 1; }
    if (trim && !jump) cmds.push([x, y, TRIM]);
    x += dx; y += dy;
    cmds.push([x, y, (jump || trim) ? JUMP : STITCH]);
  }
  // drop colour changes that come before any stitch, and trailing ones
  while (cmds.length && cmds[cmds.length - 1][2] !== STITCH) cmds.pop();
  const blocks = cmds.filter(c => c[2] === COLOR_CHANGE).length + 1;
  const threads = [];
  for (let k = 0; k < blocks; k++) {
    const idx = colorIdx[Math.min(k, colorIdx.length - 1)];
    const c = PEC_PALETTE[idx % PEC_PALETTE.length];
    threads.push(c === null || c === undefined ? 0x808080 : c);
  }
  let stitches = 0;
  for (const c of cmds) if (c[2] === STITCH) stitches++;
  return { label, cmds, threads, stitches };
}

/* Join several designs into one: parts = [{ cmds (mm, absolute), threads, kind, name }].
   Each part keeps its own stitches; a thread change separates the parts. */
function mergeDesigns(parts, opts) {
  let out = [];
  const threads = [], groups = [];
  for (const pt of parts) {
    const cmds = pt.cmds.filter(c => c[2] !== END);
    if (!cmds.some(c => c[2] === STITCH)) continue;
    if (out.length) { const l = out[out.length - 1]; out.push([l[0], l[1], TRIM], [l[0], l[1], COLOR_CHANGE]); }
    if (cmds[0][2] !== JUMP) out.push([cmds[0][0], cmds[0][1], JUMP]);
    let prev = null;
    for (const c of cmds) {
      // keep every stitch short enough for the machine (only matters for enlarged designs)
      if (c[2] === STITCH && prev) {
        const d = hyp(prev, c);
        if (d > 12) { const n = Math.ceil(d / 7); for (let k = 1; k < n; k++) out.push([prev[0] + (c[0] - prev[0]) * k / n, prev[1] + (c[1] - prev[1]) * k / n, STITCH]); }
      }
      out.push(c);
      prev = c;
    }
    threads.push(...pt.threads);
    groups.push({ kind: pt.kind, name: pt.name || '', n: pt.threads.length });
  }
  if (!out.length) return null;
  const l = out[out.length - 1];
  out.push([l[0], l[1], TRIM], [l[0], l[1], END]);
  let basted = false;
  if (opts && opts.basting) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of out) if (c[2] === STITCH) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }
    const m = 2.5;
    const bb = new Builder();
    bb.points(runPath([[x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m], [x0 - m, y0 - m]], 4.0));
    bb.colorChange();
    out = bb.cmds.concat(out);
    threads.unshift(0xa8a8a8); groups.unshift({ kind: 'basting', name: '', n: 1 });
    basted = true;
  }
  // jump threads to cut: jumps that leave a stitch within the same colour
  let cuts = 0, last = null;
  for (const c of out) {
    if (c[2] === JUMP && last === STITCH) cuts++;
    if (c[2] !== TRIM) last = c[2];
  }
  const res = finish({ cmds: out, trims: cuts }, threads, []);
  res.groups = groups; res.basting = basted;
  return res;
}

/* Fabric presets: density (lines per mm), satin and fill pull compensation (mm), underlay.
   Stretchy or thick fabrics get more pull compensation and underlay; denim gets less. */
const FABRICS = {
  cotton: { lines: 3.3, pull: 0.2, fillPull: 0.15, underlay: 'normal' },
  tshirt: { lines: 3.1, pull: 0.35, fillPull: 0.3, underlay: 'heavy' },
  polo: { lines: 3.0, pull: 0.35, fillPull: 0.3, underlay: 'heavy' },
  denim: { lines: 3.0, pull: 0.15, fillPull: 0.1, underlay: 'light' },
  towel: { lines: 3.6, pull: 0.3, fillPull: 0.25, underlay: 'heavy' },
  fleece: { lines: 3.6, pull: 0.3, fillPull: 0.25, underlay: 'heavy' }
};

const Emb = { readPES, mergeDesigns, FABRICS, logoToLayer, backgroundSet, boldThinLines, _int: { thin, skeletonGraph, pruneEdges, distIn, openMask, erode, dilate, labelComponents, networkBlocks }, digitize, analyzeColors, writePES, makeZip, brotherName, nearestIndex, PEC_PALETTE, STITCH, JUMP, TRIM, END, COLOR_CHANGE };
if (typeof module !== 'undefined' && module.exports) module.exports = Emb;
root.Emb = Emb;

/* worker entry */
if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
  root.onmessage = (ev) => {
    const m = ev.data;
    try {
      if (m.type === 'digitize') {
        const res = digitize(m.params, (s) => root.postMessage({ type: 'progress', id: m.id, stage: s }));
        root.postMessage({ type: 'done', id: m.id, result: res });
      }
    } catch (err) {
      root.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
    }
  };
}
})(typeof self !== 'undefined' ? self : globalThis);
