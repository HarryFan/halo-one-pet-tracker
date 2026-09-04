/* ui-layer.js — PixiJS v8 介面層（螢幕座標，不跟著鏡頭跑）。
 *
 * 與 map-scene.js 的分工：
 *   map-scene = 世界（會被 camera 平移縮放的東西）
 *   ui-layer  = 介面（永遠貼著畫面：時間軸、定位環、回放泡泡、告警框）
 * 兩者共用同一個 PIXI.Application 與同一個 ticker，所以永遠不會有時間差。
 *
 * 文字類的 HUD 一律留在 DOM（可選取、可翻譯、螢幕閱讀器讀得到），
 * 這一層只畫圖形與一顆會跟著游標走的時間泡泡。
 */
(function () {
  'use strict';

  const D = window.HALO;
  const C = D.PALETTE;

  function createUI(app, map) {
    const layer = new PIXI.Container();
    layer.sortableChildren = true;
    app.stage.addChild(layer);

    const gLocator = new PIXI.Graphics();   // 狗狗定位環
    const gAlert = new PIXI.Graphics();     // 越界外框
    const gTimeline = new PIXI.Graphics();  // 一日時間軸
    const gBubble = new PIXI.Graphics();    // 回放泡泡
    gAlert.zIndex = 1;
    gLocator.zIndex = 2;
    gTimeline.zIndex = 3;
    gBubble.zIndex = 4;
    layer.addChild(gAlert, gLocator, gTimeline, gBubble);

    const bubbleText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13, fontWeight: '600', fill: C.textHex,
      },
    });
    bubbleText.zIndex = 5;
    bubbleText.visible = false;
    layer.addChild(bubbleText);

    let alertPulse = 0;
    let focus = 1;          // 1 = 敘事章節中；其餘區段淡出，介面才不會吵到內容

    /** 一顆小腳印，泡泡上的裝飾。 */
    function paw(g, x, y, s, color, alpha) {
      g.ellipse(x, y + 2 * s, 3.4 * s, 2.8 * s).fill({ color, alpha });
      for (let k = -1; k <= 1; k++) {
        g.circle(x + k * 3.1 * s, y - 1.6 * s - Math.abs(k) * 0.4 * s, 1.5 * s)
          .fill({ color, alpha });
      }
    }

    return {
      layer,
      update(state, dt) {
        const W = app.screen.width;
        const H = app.screen.height;
        const reduced = state.reducedMotion;

        focus += (state.uiFocus - focus) * Math.min(1, dt * 5);
        gTimeline.alpha = 0.12 + focus * 0.88;
        gLocator.alpha = 0.25 + focus * 0.75;

        /* ---- 狗狗定位環：呼吸的雙圈 + 十字 ---- */
        gLocator.clear();
        const dx = map.dogScreen.x;
        const dy = map.dogScreen.y;
        const beat = reduced ? 0.5 : (Math.sin(performance.now() * 0.0034) * 0.5 + 0.5);
        const col = state.breached ? C.accentHex : C.successHex;
        const r = 44 + beat * 14;
        gLocator.circle(dx, dy, r).stroke({ width: 2, color: col, alpha: 0.28 + beat * 0.25 });
        gLocator.circle(dx, dy, 34).stroke({ width: 2.6, color: col, alpha: 0.65 });
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([ux, uy]) => {
          gLocator.moveTo(dx + ux * 34, dy + uy * 34)
            .lineTo(dx + ux * 45, dy + uy * 45);
        });
        gLocator.stroke({ width: 2.4, color: col, alpha: 0.7, cap: 'round' });

        /* ---- 越界：畫面外框脈衝（克制，不整片變紅） ---- */
        alertPulse = state.breached
          ? Math.min(1, alertPulse + dt * 2.4)
          : Math.max(0, alertPulse - dt * 2.4);
        gAlert.clear();
        if (alertPulse > 0.001) {
          const wob = reduced ? 0.6 : (Math.sin(performance.now() * 0.005) * 0.5 + 0.5);
          const a = alertPulse * (0.3 + wob * 0.35);
          gAlert.rect(5, 5, W - 10, H - 10).stroke({ width: 4, color: C.accentHex, alpha: a });
          gAlert.rect(15, 15, W - 30, H - 30)
            .stroke({ width: 1.5, color: C.accentHex, alpha: a * 0.45 });
        }

        /* ---- 一日時間軸：畫在 stage 上緣，不跨到文字那一側 ---- */
        gTimeline.clear();
        const st = state.stage;
        const pad = st.x + 4;
        const y = Math.max(22, st.y - 18);
        const w = st.w - 8;
        const prog = (state.timeMinutes - D.DAY_START) / (D.DAY_END - D.DAY_START);
        gTimeline.moveTo(pad, y).lineTo(pad + w, y)
          .stroke({ width: 3, color: C.subHex, alpha: 0.22, cap: 'round' });
        gTimeline.moveTo(pad, y).lineTo(pad + w * prog, y)
          .stroke({ width: 3, color: C.trailHex, alpha: 0.9, cap: 'round' });
        D.WAYPOINTS.forEach((wp) => {
          if (!wp.label) return;
          const p = (wp.t - D.DAY_START) / (D.DAY_END - D.DAY_START);
          const x = pad + w * p;
          const isFence = wp.kind === 'fence-exit';
          const passed = wp.t <= state.timeMinutes;
          gTimeline.moveTo(x, y - (isFence ? 9 : 5)).lineTo(x, y + (isFence ? 9 : 5))
            .stroke({
              width: isFence ? 3 : 2,
              color: isFence ? C.accentHex : C.subHex,
              alpha: passed ? 0.9 : 0.3,
              cap: 'round',
            });
        });
        // 游標頭：一顆小腳印
        paw(gTimeline, pad + w * prog, y - 14, 1.5, C.trailHex, 0.95);

        /* ---- 回放泡泡：跟著游標，顯示該點抵達時間 ---- */
        gBubble.clear();
        if (state.hover) {
          const hx = state.hover.x;
          const hy = state.hover.y;
          bubbleText.text = state.hover.text;
          bubbleText.visible = true;
          const bw = bubbleText.width + 42;
          const bh = 30;
          // 泡泡夾在 stage 內，不會飄到文字欄上面
          const bx = Math.max(st.x, Math.min(st.x + st.w - bw, hx - bw / 2));
          const by = Math.max(st.y, hy - 54);

          gBubble.circle(hx, hy, 6).fill({ color: C.trailHex });
          gBubble.circle(hx, hy, 13).stroke({ width: 2, color: C.trailHex, alpha: 0.75 });
          gBubble.moveTo(hx, hy - 13).lineTo(hx, by + bh)
            .stroke({ width: 1.6, color: C.trailHex, alpha: 0.55 });
          gBubble.roundRect(bx, by, bw, bh, 15)
            .fill({ color: C.creamHex, alpha: 0.97 })
            .stroke({ width: 2, color: C.trailHex, alpha: 0.8 });
          paw(gBubble, bx + 16, by + bh / 2, 1.25, C.trailHex, 0.9);
          bubbleText.position.set(bx + 30, by + 7);
        } else {
          bubbleText.visible = false;
        }
      },
    };
  }

  window.HALO = Object.assign(window.HALO || {}, { createUI });
})();
