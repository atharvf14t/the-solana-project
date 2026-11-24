(() => {
  // ---------- data ----------
  // Image space of every still/clip is 5504 x 3072 (16:9).
  const IW = 5504, IH = 3072;
  const TOWER_X0 = 2218, TOWER_X1 = 3282;

  // Floor slab lines measured off the tower photo, top to bottom (floor 32 roof line .. floor 4 base).
  const LINES = [429, 495, 581, 668, 747, 816, 885, 955, 1022, 1092, 1159, 1228, 1298, 1365, 1435, 1503, 1572, 1640, 1708, 1777, 1843, 1913, 1979, 2048, 2115, 2185, 2252, 2320, 2388, 2453];
  const CROWN_TOP = 247;

  const UNITS = {
    A: {
      name: 'Residence A', short: 'Res. A', beds: 2, baths: '2', sf: '1,450', outdoor: '120 SF balcony',
      copy: 'A bay-facing two-bedroom with a full wall of glass, an open chef’s kitchen and a primary suite with a spa bath and walk-in closet.',
      img: 'assets/dh_A.jpg', base: 1290000, step: 18000,
      rooms: [
        { id: 'living', name: 'Living & Kitchen', x: 46.5, y: 40, img: 'assets/A_living.jpg' },
        { id: 'bed', name: 'Primary Bedroom', x: 24, y: 28, img: 'assets/A_bed.jpg' },
        { id: 'bath', name: 'Primary Bath', x: 27, y: 50, img: 'assets/A_bath.jpg' },
      ],
    },
    P: {
      name: 'Corner Penthouse', short: 'Penthouse', beds: 3, baths: '3.5', sf: '3,200', outdoor: '1,100 SF wraparound terrace',
      copy: 'A full corner of sky. Glass on two sides, a wraparound terrace, a chef’s kitchen in black marble and a primary suite with a soaking tub.',
      img: 'assets/dh_P.jpg', base: 5400000, step: 600000,
      rooms: [
        { id: 'great', name: 'Great Room', x: 52, y: 59, img: 'assets/P_great.jpg' },
        { id: 'kitchen', name: 'Chef’s Kitchen', x: 62.5, y: 43, img: 'assets/P_kitchen.jpg' },
        { id: 'suite', name: 'Primary Suite', x: 76, y: 31, img: 'assets/P_suite.jpg' },
        { id: 'bath', name: 'Spa Bath', x: 19.5, y: 51, img: 'assets/P_bath.jpg' },
      ],
    },
  };

  // Optional transition clips (filled in as they are rendered). key -> { src, rev }
  const CLIPS = window.TOWER_CLIPS || {};

  const floors = [];
  floors.push({ n: 33, y0: CROWN_TOP, y1: LINES[0], unit: 'P' });
  for (let i = 0; i < LINES.length - 1; i++) {
    const n = 32 - i;
    floors.push({ n, y0: LINES[i], y1: LINES[i + 1], unit: n >= 30 ? 'P' : 'A' });
  }
  const status = (n) => {
    const h = (n * 2654435761) % 97;
    return h < 18 ? 'sold' : h < 30 ? 'hold' : 'ok';
  };
  const STATUS_TEXT = { ok: 'Available', hold: 'Reserved', sold: 'Sold' };
  const price = (f) => {
    const u = UNITS[f.unit];
    const steps = f.unit === 'P' ? f.n - 30 : f.n - 4;
    const v = u.base + steps * u.step;
    return v >= 1e6 ? `$${(v / 1e6).toFixed(2).replace(/0$/, '')}M` : `$${Math.round(v / 1e3)}K`;
  };

  // ---------- dom ----------
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const towerLayer = $('#towerLayer'), towerPlane = $('#towerPlane'), bands = $('#bands');
  const unitLayer = $('#unitLayer'), unitPlane = $('#unitPlane'), unitImg = $('#unitImg'), dotsEl = $('#dots');
  const roomLayer = $('#roomLayer'), roomPlane = $('#roomPlane'), roomImg = $('#roomImg');
  const clip = $('#clip'), flash = $('#flash');
  const tag = $('#floorTag'), cursor = $('#cursor');
  const panel = $('#unitPanel'), roomBar = $('#roomBar');

  const state = { view: 'tower', hover: null, floor: null, room: null, busy: false };
  const isPortrait = () => innerWidth / innerHeight < 1;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- geometry ----------
  // Where a 16:9 frame (dollhouse / clip) sits on screen.
  function frameRect() {
    const vw = innerWidth, vh = innerHeight;
    if (isPortrait()) {
      const w = vw * 1.06, h = w * IH / IW;
      return { x: (vw - w) / 2, y: Math.max(64, vh * 0.36 - h / 2), w, h };
    }
    const s = Math.max(vw / IW, vh / IH);
    return { x: (vw - IW * s) / 2, y: (vh - IH * s) / 2, w: IW * s, h: IH * s };
  }
  // Cover fit for the tower at rest.
  function towerRest() {
    const vw = innerWidth, vh = innerHeight;
    let s = Math.max(vw / IW, vh / IH);
    if (isPortrait()) s = Math.max(vh * 0.98 / (IH - 120), vw / (TOWER_X1 - TOWER_X0 + 360));
    const cx = (TOWER_X0 + TOWER_X1) / 2;
    const tx = vw / 2 - cx * s;
    const ty = isPortrait() ? vh / 2 - (IH * 0.52) * s : (vh - IH * s) / 2;
    return { s, tx, ty };
  }
  // Crop of the tower a floor clip starts on (16:9, centred on the floor band).
  // Penthouse floors all land on floor 31's framing: P_enter was made from it, and the crown
  // sits at a different height for 30/32/33, which would ghost in the clip blend.
  function floorCrop(f) {
    const w = 1700, h = w * IH / IW;
    const g = f.unit === 'P' ? floors.find((x) => x.n === 31) : f;
    const cy = (g.y0 + g.y1) / 2;
    return { x: (TOWER_X0 + TOWER_X1) / 2 - w / 2, y: Math.max(0, cy - h / 2), w, h };
  }
  // Transform that maps image-space rect r onto screen rect fr.
  function fitRect(r, fr) {
    const s = fr.w / r.w;
    return { s, tx: fr.x - r.x * s, ty: fr.y - r.y * s };
  }
  const setT = (el, t, ms = 0, ease = 'var(--ease)') => {
    el.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    el.style.transform = `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.s})`;
  };
  const sizePlanes = () => {
    for (const p of [towerPlane, unitPlane, roomPlane]) { p.style.width = IW + 'px'; p.style.height = IH + 'px'; }
  };
  function roomFit() {
    const vw = innerWidth, vh = innerHeight;
    const s = Math.max(vw / IW, vh / IH);
    return { s, tx: (vw - IW * s) / 2, ty: (vh - IH * s) / 2 };
  }

  // ---------- tower bands ----------
  const NS = 'http://www.w3.org/2000/svg';
  for (const f of floors) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', TOWER_X0); r.setAttribute('width', TOWER_X1 - TOWER_X0);
    r.setAttribute('y', f.y0 + 2); r.setAttribute('height', f.y1 - f.y0 - 4);
    r.setAttribute('class', 'band' + (f.unit === 'P' ? ' ph' : ''));
    r.dataset.n = f.n;
    f.el = r;
    bands.appendChild(r);
  }

  function showTag(f) {
    const u = UNITS[f.unit];
    $('#ftNum').textContent = f.n;
    $('#ftType').textContent = f.n === 33 ? 'Sky Penthouse' : u.name;
    $('#ftSpec').textContent = `${u.beds} Bed · ${u.baths} Bath · ${u.sf} SF`;
    const st = status(f.n), pill = $('#ftStatus');
    pill.textContent = st === 'sold' ? 'Sold' : `${STATUS_TEXT[st]} · from ${price(f)}`;
    pill.className = 'pill' + (st === 'ok' ? '' : ' ' + st);
    $('#ftEnter').textContent = `Enter floor ${f.n}`;
    if (!isPortrait()) {
      const t = currentTower;
      const x = TOWER_X1 * t.s + t.tx + 6;
      const y = ((f.y0 + f.y1) / 2) * t.s + t.ty;
      tag.style.left = x + 'px'; tag.style.top = y + 'px';
    }
    tag.classList.add('on');
  }
  function setHover(f) {
    if (state.hover === f) return;
    if (state.hover) state.hover.el.classList.remove('on');
    state.hover = f;
    if (f) { f.el.classList.add('on'); showTag(f); cursor.classList.add('big'); }
    else { tag.classList.remove('on'); cursor.classList.remove('big'); }
  }

  bands.addEventListener('pointermove', (e) => {
    if (state.view !== 'tower' || state.busy || e.pointerType === 'touch') return;
    const n = +e.target.dataset?.n;
    setHover(n ? floors.find((f) => f.n === n) : null);
  });
  bands.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && state.view === 'tower') setHover(null); });
  bands.addEventListener('click', (e) => {
    if (state.view !== 'tower' || state.busy) return;
    const n = +e.target.dataset?.n;
    const f = floors.find((x) => x.n === n);
    if (!f) { setHover(null); return; }
    // touch: first tap selects, second tap (or the button) enters
    if (coarse && state.hover !== f) { setHover(f); return; }
    enterFloor(f);
  });
  $('#ftEnter').addEventListener('click', () => state.hover && enterFloor(state.hover));

  // ---------- media helpers ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  const loaded = (img, src) => new Promise((res) => {
    if (img.getAttribute('src') === src && img.complete) return res();
    img.onload = () => res(); img.onerror = () => res(); img.src = src;
  });
  const preload = (src) => { const i = new Image(); i.src = src; };

  function placeClip() {
    const fr = frameRect();
    // inset must come first: set after left/top it wipes them and the clip draws off-position on non-16:9 screens.
    Object.assign(clip.style, { inset: 'auto', left: fr.x + 'px', top: fr.y + 'px', width: fr.w + 'px', height: fr.h + 'px', objectFit: 'fill' });
  }
  // Clips are fetched whole into blob URLs so a click never waits on the network.
  const blobs = new Map();
  const warm = (src) => {
    if (!src || reduce) return null;
    if (!blobs.has(src)) blobs.set(src, fetch(src).then((r) => r.blob()).then((b) => URL.createObjectURL(b)).catch(() => src));
    return blobs.get(src);
  };
  // Forward room clips load when a unit opens; each reverse clip loads only once you are in front of it.
  const warmUnit = (k) => {
    warm(CLIPS[`${k}_enter`]?.rev);
    UNITS[k].rooms.forEach((r) => warm(CLIPS[`${k}_${r.id}`]?.src));
  };

  async function playClip(src, rate = 1.2, onPlay) {
    if (!src || reduce) return false;
    placeClip();
    clip.src = await warm(src);
    clip.playbackRate = rate;
    clip.defaultPlaybackRate = rate;
    try {
      await new Promise((res, rej) => { clip.oncanplay = res; clip.onerror = rej; clip.load(); });
      clip.currentTime = 0;
      await clip.play();
    } catch { return false; }
    show(clip);
    onPlay?.();
    await new Promise((res) => { clip.onended = res; });
    return true;
  }
  const endClip = () => { hide(clip); clip.pause(); };

  // The enter clips were made from floor 22 / 31, so other floors have different lit windows.
  // Keep the real tower on top of the clip, move it with the clip's tracked camera (c.lead),
  // and dissolve it: out over the first frames going in, in over the last frames coming back.
  function towerBlend(c, t0, reverse, n0) {
    if (!c?.lead || c.from?.includes(n0)) return;
    const fr = frameRect(), k = fr.w / c.w, n = c.lead.length - 1, fade = Math.min(n, 30);
    const smooth = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
    towerLayer.style.zIndex = 2;
    const draw = (time) => {
      const vf = time * c.fps;
      const f = Math.min(reverse ? clip.duration * c.fps - 1 - vf : vf, n);
      if (f < 0 || f > n) return;
      const i = Math.floor(f), a = f - i, A = c.lead[i], B = c.lead[Math.min(i + 1, n)];
      const s = A[0] + (B[0] - A[0]) * a, dx = A[1] + (B[1] - A[1]) * a, dy = A[2] + (B[2] - A[2]) * a;
      setT(towerPlane, { s: t0.s * s, tx: fr.x + s * (t0.tx - fr.x) + dx * k, ty: fr.y + s * (t0.ty - fr.y) + dy * k });
      towerLayer.style.opacity = 1 - smooth(f / fade);
    };
    // 'ended' can run after back() has already started easing the tower out, so never touch it twice.
    let over = false;
    const done = () => {
      if (over) return; over = true;
      towerLayer.style.zIndex = ''; towerLayer.style.opacity = '';
      if (!reverse) setT(towerPlane, t0);
    };
    draw(clip.currentTime);
    const tick = (now, meta) => {
      // A frame callback still queued from an earlier clip must never move the tower again.
      if (over) return;
      draw(meta ? meta.mediaTime : clip.currentTime);
      if (clip.ended || clip.paused) return done();
      if (!reverse && clip.currentTime * c.fps > n) return done();
      clip.requestVideoFrameCallback ? clip.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    clip.addEventListener('ended', done, { once: true });
    tick();
  }

  // ---------- views ----------
  let currentTower = towerRest();

  const FULL = { x: 0, y: 0, w: IW, h: IH };
  // Resting spot for the dollhouse: left of the info panel on desktop, under the header on phones.
  function unitRest() {
    if (isPortrait()) return fitRect(FULL, frameRect());
    const vw = innerWidth, vh = innerHeight, panelW = 410;
    const aw = vw - panelW - 24, ah = vh - 96;
    const s = Math.min(aw / (IW * 0.84), ah / (IH * 0.8));
    return { s, tx: 12 + aw / 2 - (IW / 2) * s, ty: 60 + ah / 2 - (IH / 2) * s };
  }
  function layoutUnit() { setT(unitPlane, unitRest()); }
  const unitAtFrame = () => setT(unitPlane, fitRect(FULL, frameRect()));
  function syncDotsTo(t) { dotsEl.style.setProperty('--inv', 1 / t.s); }

  async function enterFloor(f) {
    state.busy = true; state.floor = f;
    const u = UNITS[f.unit];
    setHover(null);
    app.dataset.view = 'zoom';
    const imgReady = loaded(unitImg, u.img);
    u.rooms.forEach((r) => preload(r.img));
    warmUnit(f.unit);

    // 1) camera pushes into the floor
    const t = fitRect(floorCrop(f), frameRect());
    f.el.classList.add('on');
    setT(towerPlane, t, reduce ? 0 : 1100);
    currentTower = t;
    await wait(reduce ? 0 : 1050);
    f.el.classList.remove('on');
    await imgReady;
    unitAtFrame();
    buildUnitUI(f);

    // 2) fly-through clip if we have one, else a soft dive
    const ec = CLIPS[`${f.unit}_enter`];
    const played = await playClip(ec?.src, ec?.rate, () => towerBlend(ec, t, false, f.n));
    if (played) {
      show(unitLayer); unitLayer.style.opacity = 1; hide(towerLayer); endClip();
    } else {
      const fr = frameRect(), base = fitRect({ x: 0, y: 0, w: IW, h: IH }, fr);
      const from = { s: base.s * 1.18, tx: base.tx - (IW * base.s * 0.09), ty: base.ty - (IH * base.s * 0.09) };
      setT(unitPlane, from);
      unitLayer.style.transition = 'none'; unitLayer.style.opacity = 0; show(unitLayer);
      unitLayer.getBoundingClientRect();
      unitLayer.style.transition = 'opacity .7s ease';
      unitLayer.style.opacity = 1;
      setT(unitPlane, base, reduce ? 0 : 1300, 'var(--ease-out)');
      await wait(reduce ? 0 : 900);
      hide(towerLayer);
    }
    const rest = unitRest();
    setT(unitPlane, rest, reduce ? 0 : 900, 'var(--ease)');
    syncDotsTo(rest);
    app.dataset.view = 'unit'; state.view = 'unit';
    panel.classList.add('on'); panel.setAttribute('aria-hidden', 'false');
    [...dotsEl.children].forEach((d, i) => setTimeout(() => d.classList.add('on'), 120 * i));
    state.busy = false;
  }

  function buildUnitUI(f) {
    const u = UNITS[f.unit];
    $('#pEyebrow').textContent = `Floor ${f.n} · ${STATUS_TEXT[status(f.n)]}`;
    $('#pTitle').textContent = f.n === 33 ? 'Sky Penthouse' : u.name;
    $('#pSpecs').innerHTML = `<div><strong>${u.beds}</strong><span>Bedrooms</span></div><div><strong>${u.baths}</strong><span>Baths</span></div><div><strong>${u.sf}</strong><span>Sq Ft</span></div>`;
    $('#pPrice').textContent = price(f);
    $('#pCopy').textContent = `${u.copy} Plus ${u.outdoor}.`;
    const list = $('#pRooms'); list.innerHTML = '';
    dotsEl.innerHTML = '';
    u.rooms.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'dot';
      d.style.left = (r.x / 100) * IW + 'px'; d.style.top = (r.y / 100) * IH + 'px';
      d.innerHTML = `<button type="button" aria-label="Go to ${r.name}"><i></i></button><span class="dl">${r.name}</span>`;
      d.querySelector('button').addEventListener('click', () => enterRoom(r));
      dotsEl.appendChild(d);
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = r.name;
      b.addEventListener('click', () => enterRoom(r));
      b.addEventListener('pointerenter', () => d.classList.add('hot'));
      b.addEventListener('pointerleave', () => d.classList.remove('hot'));
      list.appendChild(b);
    });
    // dots counter-scale so they stay a constant size on screen
    requestAnimationFrame(syncDotScale);
  }
  function syncDotScale() { syncDotsTo(state.view === 'zoom' ? fitRect(FULL, frameRect()) : unitRest()); }

  async function enterRoom(r, fromRoom = false) {
    if (state.busy) return;
    state.busy = true;
    const f = state.floor, u = UNITS[f.unit];
    const imgReady = loaded(roomImg, r.img);
    state.room = r;
    warm(CLIPS[`${f.unit}_${r.id}`]?.rev);
    panel.classList.remove('on'); panel.setAttribute('aria-hidden', 'true');
    roomBar.classList.remove('on');
    [...dotsEl.children].forEach((d) => d.classList.remove('on'));
    syncDotScale();

    if (fromRoom) {
      flash.classList.add('on'); await wait(350); await imgReady;
      setT(roomPlane, roomFit());
      flash.classList.remove('on');
    } else {
      await imgReady;
      const rc = CLIPS[`${f.unit}_${r.id}`], src = rc?.src;
      if (src && !reduce) { unitAtFrame(); unitPlane.style.transition = 'transform .6s var(--ease)'; await wait(600); }
      const played = await playClip(src, rc?.rate);
      if (played) {
        setT(roomPlane, fitRect({ x: 0, y: 0, w: IW, h: IH }, frameRect()));
        roomLayer.style.transition = 'none'; roomLayer.style.opacity = 1; show(roomLayer);
        hide(unitLayer); endClip();
        roomPlane.getBoundingClientRect();
        setT(roomPlane, roomFit(), 700, 'var(--ease-out)');
      } else {
        // dive toward the dot, then fade the room in
        const base = unitRest();
        const k = 2.6, px = (r.x / 100) * IW, py = (r.y / 100) * IH;
        const z = { s: base.s * k, tx: innerWidth / 2 - px * base.s * k, ty: innerHeight / 2 - py * base.s * k };
        setT(unitPlane, z, reduce ? 0 : 1000);
        const rf = roomFit();
        setT(roomPlane, { s: rf.s * 1.12, tx: rf.tx - IW * rf.s * 0.06, ty: rf.ty - IH * rf.s * 0.06 });
        await wait(reduce ? 0 : 550);
        roomLayer.style.transition = 'opacity .6s ease'; roomLayer.style.opacity = 0; show(roomLayer);
        roomLayer.getBoundingClientRect();
        roomLayer.style.opacity = 1;
        setT(roomPlane, rf, reduce ? 0 : 1400, 'var(--ease-out)');
        await wait(reduce ? 0 : 650);
        hide(unitLayer); layoutUnit();
      }
    }
    $('#rbFloor').textContent = `Floor ${f.n} · ${f.n === 33 ? 'Sky Penthouse' : u.name}`;
    $('#rbRoom').textContent = r.name;
    const chips = $('#rbChips'); chips.innerHTML = '';
    u.rooms.forEach((x) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = x.name;
      if (x === r) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => x !== state.room && enterRoom(x, true));
      chips.appendChild(b);
    });
    roomBar.classList.add('on'); roomBar.setAttribute('aria-hidden', 'false');
    app.dataset.view = 'room'; state.view = 'room';
    state.busy = false;
  }

  async function back() {
    if (state.busy) return;
    state.busy = true;
    if (state.view === 'room') {
      const f = state.floor, r = state.room;
      roomBar.classList.remove('on');
      const rev = CLIPS[`${f.unit}_${r.id}`]?.rev;
      if (rev && !reduce) {
        unitAtFrame();
        setT(roomPlane, fitRect(FULL, frameRect()), 500);
        await wait(480);
        if (await playClip(rev, 1.5)) { show(unitLayer); hide(roomLayer); endClip(); }
        else { show(unitLayer); hide(roomLayer); }
        layoutUnit();
        unitPlane.style.transition = 'transform .9s var(--ease)';
      } else {
        layoutUnit();
        unitLayer.style.transition = 'none'; unitLayer.style.opacity = 1; show(unitLayer);
        roomLayer.style.transition = 'opacity .6s ease'; roomLayer.style.opacity = 0;
        await wait(600); hide(roomLayer);
      }
      app.dataset.view = 'unit'; state.view = 'unit';
      panel.classList.add('on'); panel.setAttribute('aria-hidden', 'false');
      [...dotsEl.children].forEach((d, i) => setTimeout(() => { d.classList.add('on'); syncDotScale(); }, 100 * i));
    } else if (state.view === 'unit') {
      const f = state.floor;
      panel.classList.remove('on'); panel.setAttribute('aria-hidden', 'true');
      [...dotsEl.children].forEach((d) => d.classList.remove('on'));
      const ec = CLIPS[`${f.unit}_enter`], rev = ec?.rev;
      if (rev && !reduce) { setT(unitPlane, fitRect(FULL, frameRect()), 700); await wait(700); }
      currentTower = fitRect(floorCrop(f), frameRect());
      setT(towerPlane, currentTower);
      if (rev && !reduce) towerLayer.style.opacity = 0;
      show(towerLayer);
      const played = rev && await playClip(rev, 1.5, () => towerBlend(ec, currentTower, true, f.n));
      towerLayer.style.opacity = '';
      if (played) { hide(unitLayer); endClip(); }
      else {
        unitLayer.style.transition = 'opacity .6s ease'; unitLayer.style.opacity = 0;
        await wait(600); hide(unitLayer);
      }
      currentTower = towerRest();
      setT(towerPlane, currentTower, reduce ? 0 : 1200);
      await wait(reduce ? 0 : 1200);
      app.dataset.view = 'tower'; state.view = 'tower';
    }
    state.busy = false;
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.action === 'back') back();
    if (a.dataset.action === 'inquire') toast('Demo: this opens the private tour / floor plan request form.');
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    app.appendChild(t); setTimeout(() => t.remove(), 2700);
  }

  // ---------- cursor ----------
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    const hot = e.target.closest('.dot button, button, a, .band');
    cursor.classList.toggle('big', !!hot);
  });

  // ---------- layout + intro ----------
  function relayout() {
    sizePlanes();
    if (state.view === 'tower') { currentTower = towerRest(); setT(towerPlane, currentTower); }
    else if (state.floor) { currentTower = fitRect(floorCrop(state.floor), frameRect()); setT(towerPlane, currentTower); }
    layoutUnit(); syncDotScale();
    if (state.view === 'room') setT(roomPlane, roomFit());
    if (state.hover) showTag(state.hover);
  }
  addEventListener('resize', relayout);
  relayout();

  async function intro() {
    if (reduce) return;
    const t = towerRest();
    setT(towerPlane, { s: t.s * 1.06, tx: t.tx - (IW * t.s * 0.03), ty: t.ty - (IH * t.s * 0.05) });
    towerPlane.getBoundingClientRect();
    setT(towerPlane, t, 2600, 'var(--ease-out)');
    await wait(1600);
    // scan the floors bottom-to-top once
    const order = [...floors].reverse();
    order.forEach((f, i) => setTimeout(() => {
      if (state.hover || state.view !== 'tower') return;
      f.el.classList.add('scan');
      setTimeout(() => f.el.classList.remove('scan'), 260);
    }, i * 38));
  }
  $('#towerImg').decode?.().then(intro, intro);
  addEventListener('load', () => setTimeout(() => {
    for (const k of Object.keys(UNITS)) { const e = CLIPS[`${k}_enter`]; warm(e?.src); preload(UNITS[k].img); }
  }, 1200));
  if (coarse) $('#hintText').textContent = 'Tap a floor to explore';
})();
