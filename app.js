/* app.js — 編排層。
 *
 * 一個 PIXI.Application、一個 rAF、兩個容器：
 *   map-scene（世界，被 camera 平移縮放） + ui-layer（介面，貼著畫面）
 *
 * 捲動事件只寫 target，插值全在 rAF（避免快速捲動時鏡頭跳動）。
 * 核心章節 #journey-section 是 600vh 的單一捲動軸，四個 beat 由 fit() 區間
 * 分批揭露 —— 結構原型 E 單軸長捲動。
 */
(function () {
  'use strict';

  const D = window.HALO;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  /** 把 e 從 [t,i] 映射到 [r,o]，可選 easing。所有 beat 的揭露區間都靠它。 */
  function fit(e, t, i, r, o, ease) {
    let x = clamp01((e - t) / (i - t));
    if (ease) x = ease(x);
    return r + x * (o - r);
  }
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  /** 區塊頂端過視窗頂端算 0，每捲一個視窗高 +1。 */
  const screenOffset = (el) => -el.getBoundingClientRect().top / window.innerHeight;

  function setVH() {
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }

  /* ---------- 由資料填內容（文案只有一份，在 track-data.js） ---------- */
  function hydrate() {
    $('#hero-title').textContent = D.COPY.heroTitle;
    $('#hero-sub').textContent = D.COPY.heroSub;

    D.COPY.chapters.forEach((c, i) => {
      const card = document.getElementById('beat-' + i);
      if (!card) return;
      card.querySelector('[data-kicker]').textContent = c.kicker;
      card.querySelector('[data-title]').textContent = c.title;
      card.querySelector('[data-body]').textContent = c.body;
      card.querySelector('[data-value]').textContent = c.metricValue;
      card.querySelector('[data-unit]').textContent = c.metricUnit;
      card.querySelector('[data-label]').textContent = c.metricLabel;
    });

    $('#spec-table tbody').innerHTML = D.COPY.specs
      .map((s) => `<tr><th scope="row">${s.k}</th><td>${s.v}</td></tr>`).join('');
    $('#scenarios').innerHTML = D.COPY.scenarios
      .map((s) => `<div class="scenario reveal"><h3>${s.t}</h3><p>${s.d}</p></div>`).join('');
    $('#trust-row').innerHTML = D.COPY.trust
      .map((t) => `<div class="trust-cell reveal"><b>${t.n}</b><span>${t.d}</span></div>`).join('');

    $('#cta-price').textContent = D.COPY.cta.price;
    $('#cta-note').textContent = D.COPY.cta.note;
    $('#order-btn').textContent = D.COPY.cta.label;

    $('#swatches').innerHTML = D.COPY.collarColors
      .map((c, i) =>
        `<button class="swatch" data-i="${i}" style="background:${c.css}" ` +
        `aria-pressed="${i === 0}" aria-label="項圈顏色 ${c.name}"></button>`).join('');

    $('#breeds').innerHTML = Object.values(D.BREEDS)
      .map((b, i) =>
        `<button class="breed-btn" data-breed="${b.id}" aria-pressed="${i === 0}">${b.name}</button>`)
      .join('');
  }

  async function main() {
    setVH();
    hydrate();

    /* ---- 單一 Pixi App ---- */
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0,          // 底色交給 CSS，地圖自己畫紙底
      antialias: true,
      autoDensity: true,
      autoStart: false,            // 用我們自己的 rAF，全站一個時鐘
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    });
    const host = $('#pixi-container');
    host.appendChild(app.canvas);
    app.canvas.style.pointerEvents = 'none';   // 命中判定自己做，DOM 完全不受影響

    const map = D.createMap(app);
    const ui = D.createUI(app, map);

    /* ---- 狀態 ---- */
    const state = {
      timeMinutes: D.DAY_START,
      targetTime: D.DAY_START,
      manualTime: null,
      fenceRadius: D.CITY.homeRadius,
      collar: D.COPY.collarColors[0].hex,
      breached: false,
      hover: null,
      scrollProgress: 0,
      viewScale: 1,
      mapHidden: false,     // 規格區之後地圖已淡出，不必再畫
      // stage = 地圖唯一被允許演出的矩形（由 #map-stage 量出來）。
      // 文字住在 rail，兩塊互不重疊，鏡頭對準 stage 中心而不是視窗中心。
      stage: { x: 0, y: 0, w: 1, h: 1 },
      uiFocus: 1,           // 介面層專注度：敘事章節 1、其他區段淡出
      parallax: { x: 0, y: 0 },
      reducedMotion,
    };

    const stageEl = $('#map-stage');

    /** 手機版的文字 sheet 高度＝當前 beat 卡片的實際高度，不是猜一個 vh。
     *  回寫成 --sheet-h，告警條與地圖 stage 都吃這個值，三者永遠對齊。 */
    function syncSheet() {
      if (window.innerWidth > 900) return;
      const card = document.querySelector('.beat-card.on') || document.getElementById('beat-0');
      if (!card) return;
      // 量「聯集頂緣」而不是把高度相加：卡片與告警之間有間距時，
      // 相加會少算，stage 底邊就會被卡片吃掉幾個 px。
      const root = document.documentElement.style;
      const cardTop = card.getBoundingClientRect().top;
      root.setProperty('--card-h', Math.round(window.innerHeight - cardTop) + 'px');

      const alertEl = document.querySelector('.alert-banner.on');
      // 讀 rect 會強制 reflow，所以告警是用剛寫入的 --card-h 定位後才量到的
      const top = alertEl ? Math.min(cardTop, alertEl.getBoundingClientRect().top) : cardTop;
      root.setProperty('--sheet-h', Math.max(120, Math.round(window.innerHeight - top)) + 'px');
    }

    /** 量 stage 矩形；縮放依 stage 寬度而不是視窗寬度，手機才不會只看得到狗。 */
    function measureStage() {
      const r = stageEl.getBoundingClientRect();
      state.stage.x = r.left;
      state.stage.y = r.top;
      state.stage.w = Math.max(120, r.width);
      state.stage.h = Math.max(120, r.height);
      const fit = Math.min(state.stage.w / 1180, state.stage.h / 760);
      state.viewScale = Math.max(0.5, Math.min(1, fit));
    }

    function resize() {
      setVH();
      syncSheet();
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      if (app.renderer.resolution !== dpr) app.renderer.resolution = dpr;
      measureStage();
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();

    const journey = $('#journey-section');
    const railScrim = $('#rail-scrim');
    const beatCards = [0, 1, 2, 3].map((i) => document.getElementById('beat-' + i));
    const hudTime = $('#hud-time');
    const hudDist = $('#hud-dist');
    const hudState = $('#hud-state');
    const alertBanner = $('#alert-banner');
    const alertText = $('#alert-text');
    const replayBox = $('#replay-readout');
    const replayTime = $('#replay-time');
    const replayMeta = $('#replay-meta');
    const timeRange = $('#time-range');
    const timeNow = $('#time-now');

    let scrollVelocity = 0;
    let lastScrollY = window.scrollY;

    function onScroll() {
      const y = window.scrollY;
      const vh = window.innerHeight;
      scrollVelocity = Math.abs(y - lastScrollY) / vh;
      lastScrollY = y;

      const docH = document.documentElement.scrollHeight - vh;
      state.scrollProgress = clamp01(docH > 0 ? y / docH : 0);

      // 核心章節：捲動軸 = 06:00 → 22:00
      const r = screenOffset(journey);
      const inJourney = r > -0.9 && r < 6.6;
      if (inJourney) {
        state.manualTime = null;
        const t = fit(r, 0, 5.6, 0, 1, easeInOutCubic);
        state.targetTime = D.DAY_START + (D.DAY_END - D.DAY_START) * t;
      } else if (state.manualTime === null) {
        state.targetTime = r <= 0 ? D.DAY_START : D.DAY_END;
      }

      /* 地圖戲份：捲過控制台之後逐段退場，文字區塊才不會跟街廓糊在一起 */
      const midline = vh * 0.5;
      const topOf = (id) => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().top : Infinity;
      };
      let phase = 'story';
      if (topOf('tech-section') <= midline) phase = 'console';
      if (topOf('manifesto-section') <= midline) phase = 'statement';
      if (topOf('order-section') <= midline) phase = 'ground';
      if (document.body.dataset.map !== phase) document.body.dataset.map = phase;
      state.mapHidden = phase === 'ground';

      state.uiFocus = inJourney ? 1 : 0.2;
      railScrim.classList.toggle('on', inJourney);
      syncSheet();
      measureStage();

      const bands = [[0.15, 1.5], [1.5, 3.0], [3.0, 4.3], [4.3, 6.2]];
      beatCards.forEach((card, i) => {
        if (!card) return;
        const on = r >= bands[i][0] && r < bands[i][1];
        card.classList.toggle('on', on);
        card.parentElement.style.visibility =
          on || (r > bands[i][0] - 1 && r < bands[i][1] + 1) ? 'visible' : 'hidden';
      });

      const secs = ['hero-section', 'journey-section', 'tech-section', 'order-section'];
      let active = 0;
      secs.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= vh * 0.4) active = i;
      });
      $$('header nav a').forEach((a, i) => a.classList.toggle('active', i === active));
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---- 游標：視差 + 軌跡命中 ---- */
    const pointer = { x: 0, y: 0, active: false };
    if (!coarse) {
      window.addEventListener('pointermove', (e) => {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.active = true;
        if (!reducedMotion) {
          state.parallax.x = (e.clientX / window.innerWidth - 0.5);
          state.parallax.y = (e.clientY / window.innerHeight - 0.5);
        }
      }, { passive: true });
      window.addEventListener('pointerleave', () => { pointer.active = false; });
    }

    /* 觸控裝置沒有 hover：點地圖上的軌跡就等於「檢視這個點」，
       再點空白處收起。桌機的 hover 行為完全不變。 */
    if (coarse) {
      window.addEventListener('pointerdown', (e) => {
        if (e.target.closest('header, .content, .mobile-nav')) return;
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.active = true;
        if (!hitTest()) pointer.active = false;      // 沒點到軌跡就收起
      }, { passive: true });
    }

    /** 螢幕游標 → 最近的軌跡取樣點；回傳抵達時間與離家距離。 */
    function hitTest() {
      if (!pointer.active) return null;
      const w = map.toWorld(pointer.x, pointer.y);
      const path = map.path;
      const step = 3;                        // 每 3 個取樣測一次，夠準又便宜
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < path.length; i += step) {
        const dx = path[i].x - w.x;
        const dy = path[i].y - w.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; bestI = i; }
      }
      if (bestI < 0) return null;
      // 命中半徑換算成螢幕像素，縮放時手感一致
      const zoom = map.camera.scale.x || 1;
      if (Math.sqrt(bestD) * zoom > (coarse ? 52 : 34)) return null;   // 手指比游標粗

      const minutes = map.indexToTime(bestI);
      const p = path[bestI];
      const distUnits = Math.hypot(p.x - map.homeWorld.x, p.y - map.homeWorld.y) / D.SCALE;
      const meters = Math.round(distUnits * D.METERS_PER_UNIT);
      const s = map.toScreen(p.x, p.y);
      return { x: s.x, y: s.y, minutes, meters, text: `${D.clock(minutes)}　離家 ${meters} m` };
    }

    /* ---- 控制台 ---- */
    const fenceRange = $('#fence-range');
    const fenceNum = $('#fence-num');
    fenceRange.addEventListener('input', () => {
      const r = Number(fenceRange.value);
      state.fenceRadius = r;
      map.setFenceRadius(r);
      const meters = Math.round(r * D.METERS_PER_UNIT);
      fenceNum.textContent = meters;
      fenceRange.setAttribute('aria-valuetext', meters + ' 公尺');
    });
    map.setFenceRadius(state.fenceRadius);
    fenceNum.textContent = Math.round(state.fenceRadius * D.METERS_PER_UNIT);

    const swatchName = $('#swatch-name');
    $$('.swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = D.COPY.collarColors[Number(btn.dataset.i)];
        state.collar = c.hex;
        map.setCollarColor(c.hex);
        swatchName.textContent = c.name;
        $$('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      });
    });
    map.setCollarColor(state.collar);

    const breedName = $('#breed-name');
    $$('.breed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        map.setBreed(btn.dataset.breed);
        breedName.textContent = D.BREEDS[btn.dataset.breed].name;
        $$('.breed-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      });
    });

    timeRange.addEventListener('input', () => {
      const t = Number(timeRange.value);
      state.manualTime = t;
      state.targetTime = t;
      timeNow.textContent = D.clock(t);
      timeRange.setAttribute('aria-valuetext', D.clock(t));
    });

    /* ---- 手機：操作控制台時讓地圖浮上來（桌機看得到地圖，不需要） ---- */
    let peekTimer = 0;
    function peek() {
      if (window.innerWidth > 900) return;
      document.body.classList.add('peek');
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => document.body.classList.remove('peek'), 1100);
    }
    $('#console').addEventListener('input', peek);
    $('#console').addEventListener('pointerdown', peek);

    /* ---- CTA ---- */
    $('#hero-cta-btn').addEventListener('click', () => {
      journey.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    $('#hero-spec-btn').addEventListener('click', () => {
      $('#order-section').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    const orderBtn = $('#order-btn');
    orderBtn.addEventListener('click', () => {
      if (orderBtn.classList.contains('done')) return;
      orderBtn.classList.add('done');
      orderBtn.textContent = D.COPY.cta.confirmed;
      $('#cta-note').textContent = '我們會在出貨前 7 天寄出通知信。';
    });

    /* ---- 行動版導覽 ---- */
    const mobileNav = $('#mobile-nav');
    const navToggle = $('#nav-toggle');
    navToggle.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    $$('#mobile-nav a').forEach((a) => a.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }));

    /* ---- 進場揭露 ---- */
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }),
      { threshold: 0.18 }
    );
    $$('.reveal').forEach((el) => io.observe(el));

    /* ---- 單一 rAF ---- */
    let last = performance.now();
    let wasBreached = false;

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // 捲動敘事走電影感（-6）；手動拖時間軸改用 configurator 檔位（-14）
      const rate = state.manualTime !== null ? 14 : 6;
      let damp = reducedMotion ? 1 : 1 - Math.exp(-rate * dt);
      damp = Math.max(damp, Math.min(1, scrollVelocity * 10));
      scrollVelocity *= Math.exp(-3 * dt);
      state.timeMinutes += (state.targetTime - state.timeMinutes) * damp;
      if (Math.abs(state.targetTime - state.timeMinutes) < 0.4) state.timeMinutes = state.targetTime;

      if (!state.mapHidden) {
        map.update(state, dt);
        state.breached = map.breached;
        state.hover = hitTest();
        ui.update(state, dt);
        app.ticker.update();        // 這一行才會真的送出 render
      } else if (state.hover) {
        state.hover = null;         // 地圖不在畫面上，回放泡泡也該收掉
      }

      /* ---- DOM HUD ---- */
      hudTime.textContent = D.clock(state.timeMinutes);
      hudDist.textContent =
        Math.round(map.distanceFromHome * D.METERS_PER_UNIT).toLocaleString('en-US') + ' m';

      if (state.breached !== wasBreached) {
        wasBreached = state.breached;
        hudState.textContent = state.breached ? '已離開安全範圍' : '安全範圍內';
        hudState.classList.toggle('state-alert', state.breached);
        hudState.classList.toggle('state-safe', !state.breached);
        alertBanner.classList.toggle('on', state.breached);
        // 告警是在 rAF 裡切換的，切完要立刻重量 sheet，地圖才會同一幀讓位
        requestAnimationFrame(() => { syncSheet(); measureStage(); });
        if (state.breached) {
          alertText.textContent =
            `Mochi 於 ${D.clock(state.timeMinutes)} 離開半徑 ` +
            `${Math.round(state.fenceRadius * D.METERS_PER_UNIT)} 公尺的安全範圍，警報已推播。`;
        }
      }

      if (state.hover) {
        replayBox.classList.add('on');
        replayTime.textContent = D.clock(state.hover.minutes);
        replayMeta.textContent = `離家 ${state.hover.meters} m · 游標所指位置的抵達時間`;
      } else {
        replayBox.classList.remove('on');
      }

      timeNow.textContent = D.clock(state.timeMinutes);
      if (state.manualTime === null) timeRange.value = String(Math.round(state.timeMinutes));
    }
    requestAnimationFrame(frame);

    requestAnimationFrame(() => {
      setTimeout(() => $('#loader').classList.add('done'), 380);
      document.body.dataset.ready = '1';
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    if (!window.PIXI) {
      console.error('[HALO] PixiJS 未載入');
      $('#loader').classList.add('done');
      return;
    }
    main().catch((err) => {
      console.error('[HALO] 初始化失敗', err);
      $('#loader').classList.add('done');
    });
  });
})();
