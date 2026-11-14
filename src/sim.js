/* Sew-out simulation, shared by both pages: replays a design's stitches in the order
   the machine sews them, pausing at each thread change. The page supplies the controls
   and draws each frame; this file keeps time and position.

   SewSim.model(result)  -> { seg (x0,y0,x1,y1 per stitch, in 0.1 mm), col (thread per
                              stitch), starts (first stitch of each thread), jumps, n, colors }
   SewSim.create(opts)   -> controller with load(result), stop(), isActive(), count()
     opts: { play, pos, speed, all, info: elements; t(key, ...args); name(threadIndex);
             render(n | null, frame) where n = stitches shown (null = show the finished design)
             and frame = { model, needle: [x, y] in 0.1 mm, banner: text or null } } */
const SewSim = (() => {
  const STITCH = 0, JUMP = 1, COLOR_CHANGE = 5;
  const SPEEDS = [25, 100, 300, 1000, 3000];         // stitches per second on screen
  const MACHINE_SPM = 600;                            // the readout's estimate: 600 stitches a minute

  function model(r) {
    const seg = [], col = [], jumps = [], starts = [0];
    let last = null, ci = 0;
    for (const [x, y, c] of r.cmds) {
      if (c === STITCH) {
        if (last) { seg.push(last[0], last[1], x, y); col.push(ci); }
        last = [x, y];
      } else if (c === JUMP) {
        // a jump longer than 1 mm leaves a thread across the top that has to be cut
        if (last && Math.hypot(x - last[0], y - last[1]) > 10) jumps.push({ at: col.length, x0: last[0], y0: last[1], x1: x, y1: y, ci });
        last = [x, y];
      } else if (c === COLOR_CHANGE) { ci++; starts.push(col.length); }
    }
    return { seg: Float32Array.from(seg), col: Uint16Array.from(col), jumps, starts, n: col.length, colors: ci + 1 };
  }

  function create(o) {
    let M = null, n = 0, active = false, playing = false, raf = 0, lastT = 0;
    let holdUntil = 0, banner = null, infoT = 0;
    const speedSel = o.speed;
    speedSel.innerHTML = '';
    ['simSlow', 'simMed', 'simFast', 'simFaster', 'simFastest'].forEach((k, i) => {
      const op = document.createElement('option'); op.value = SPEEDS[i]; op.dataset.k = k; op.textContent = o.t(k); speedSel.appendChild(op);
    });
    const block = k => { let b = 0; while (b + 1 < M.starts.length && M.starts[b + 1] <= k) b++; return b; };
    const needle = k => {
      if (!M.n) return null;
      if (k <= 0) return [M.seg[0], M.seg[1]];
      const j = (Math.min(k, M.n) - 1) * 4;
      return [M.seg[j + 2], M.seg[j + 3]];
    };
    function label() {
      o.play.textContent = playing ? o.t('simPause') : active && n > 0 && n < M.n ? o.t('simResume') : active && n >= M.n ? o.t('simAgain') : o.t('simWatch');
      o.play.setAttribute('aria-pressed', playing ? 'true' : 'false');
      o.all.disabled = !active;
    }
    function info(force) {
      const now = performance.now();
      if (!force && now - infoT < 200) return;
      infoT = now;
      if (!M || !active) { o.info.textContent = M && M.n ? o.t('simIdle') : ''; return; }
      const k = Math.floor(n), b = block(Math.min(k, M.n - 1));
      const left = Math.max(0, Math.ceil((M.n - k) / MACHINE_SPM + (M.colors - 1 - b)));
      o.info.textContent = banner || o.t('simInfo', b + 1, M.colors, o.name(b), k, M.n, left);
    }
    function frame() {
      o.render(active ? Math.floor(n) : null, { model: M, needle: active ? needle(Math.floor(n)) : null, banner: active ? banner : null });
      o.pos.value = Math.floor(n);
      info();
    }
    function tick(t) {
      raf = 0;
      if (!playing) return;
      const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
      if (t < holdUntil) { frame(); raf = requestAnimationFrame(tick); return; }
      if (banner) { banner = null; info(true); }
      const prev = n;
      n = Math.min(M.n, n + (+speedSel.value) * dt);
      // stop at the start of the next thread colour, like the machine does
      for (let b = 1; b < M.starts.length; b++) {
        const s = M.starts[b];
        if (s > prev && s <= n) { n = s; holdUntil = t + 1300; banner = o.t('simChange', b + 1, o.name(b)); info(true); break; }
      }
      if (n >= M.n) { n = M.n; playing = false; label(); frame(); info(true); return; }
      frame();
      raf = requestAnimationFrame(tick);
    }
    function play() {
      if (!M || !M.n) return;
      if (playing) { playing = false; label(); info(true); return; }
      if (!active || n >= M.n) { n = 0; holdUntil = 0; banner = null; }
      active = true; playing = true; lastT = performance.now();
      label(); frame();
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function stop() {
      playing = false; active = false; banner = null;
      if (M) n = M.n;
      label(); frame(); info(true);
    }
    o.play.onclick = play;
    o.all.onclick = stop;
    o.pos.oninput = () => {
      if (!M || !M.n) return;
      active = true; playing = false; banner = null; holdUntil = 0;
      n = +o.pos.value;
      label(); frame(); info(true);
    };
    return {
      load(r) {
        playing = false; active = false; banner = null;
        M = r && r.cmds && r.cmds.length ? model(r) : null;
        n = M ? M.n : 0;
        o.pos.max = M ? M.n : 0; o.pos.value = n;
        o.play.disabled = o.pos.disabled = speedSel.disabled = !M || !M.n;
        if (M) speedSel.value = SPEEDS.find(v => v >= M.n / 30) || SPEEDS[SPEEDS.length - 1];
        label(); info(true);
      },
      stop() { if (active) stop(); },
      pause() { if (playing) { playing = false; label(); info(true); } },
      isActive: () => active,
      count: () => (active ? Math.floor(n) : null),
      frameInfo: () => ({ model: M, needle: active ? needle(Math.floor(n)) : null, banner: active ? banner : null }),
      relabel() {
        for (const op of speedSel.options) op.textContent = o.t(op.dataset.k);
        label(); info(true);
      }
    };
  }
  return { model, create, SPEEDS };
})();
