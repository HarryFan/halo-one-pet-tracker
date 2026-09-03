/* dog-sprite.js — 柴犬 / 柯基「頭像 pin」。
 *
 * 純 PIXI.Graphics 向量頭像：沒有圖檔、沒有網路依賴，用 file:// 直接開也能跑。
 *
 * 刻意只畫頭：地圖上的定位點本來就該是一顆頭像徽章，
 * 畫全身反而要處理走路循環、朝向與透視，尺寸一縮就糊掉。
 * 頭像 pin 在任何縮放下都乾淨、可愛、辨識度高。
 *
 * 風格參照いらすとや那類日系扁平插畫：平塗色塊、無漸層、粗圓形狀、
 * 深褐描邊、黑豆眼加腮紅。沒有用任何素材站圖檔（多半禁 hotlink、
 * 商用有張數限制），全部 Pixi Graphics 畫，換色即換主題。
 *
 * 犬種差異只在 track-data.js 的 BREEDS：
 *   柴犬 = 立三角耳 + 奶油眉點 + 臉頰奶油塊
 *   柯基 = 圓大立耳 + 額頭白線
 */
(function () {
  'use strict';

  const D = window.HALO;
  const OUT = 0x3a2e25;
  const OUTW = 2.2;

  function createDog(breedId) {
    const B = D.BREEDS[breedId] || D.BREEDS.shiba;
    const P = D.PALETTE;
    const R = 26;                      // 頭半徑
    const BADGE = R + 13;              // 徽章半徑

    const root = new PIXI.Container();       // 位置由 map-scene 設，這裡不准動它的 x/y
    const rig = new PIXI.Container();        // 所有動態位移都作用在這層
    rig.sortableChildren = true;
    root.addChild(rig);

    /* 落在地圖上的影子 */
    const shadow = new PIXI.Graphics();
    shadow.ellipse(0, BADGE + 10, BADGE * 0.72, 7).fill({ color: P.shadowHex, alpha: 0.16 });
    shadow.zIndex = 0;

    /* 徽章底：奶油圓 + 項圈色外環 + 下方小尖角（地圖釘的感覺） */
    const badge = new PIXI.Graphics();
    badge.zIndex = 1;

    /* 頭本體 */
    const head = new PIXI.Container();
    head.zIndex = 2;

    const earBack = new PIXI.Graphics();
    const earFront = new PIXI.Graphics();
    function drawEar(g, x, flip) {
      g.clear();
      if (B.ear === 'triangle') {
        g.moveTo(x - 10, -R * 0.52)
          .lineTo(x + flip * 2, -R * 1.42)
          .lineTo(x + 10, -R * 0.48)
          .closePath()
          .fill({ color: B.coatDarkHex }).stroke({ width: OUTW, color: OUT, alpha: 0.8 });
        g.moveTo(x - 4.5, -R * 0.66)
          .lineTo(x + flip * 1.5, -R * 1.16)
          .lineTo(x + 4.5, -R * 0.64)
          .closePath()
          .fill({ color: P.blushHex, alpha: 0.6 });
      } else {
        g.ellipse(x, -R * 0.95, 10.5, 15.5)
          .fill({ color: B.coatDarkHex }).stroke({ width: OUTW, color: OUT, alpha: 0.8 });
        g.ellipse(x, -R * 0.93, 5, 9).fill({ color: P.blushHex, alpha: 0.55 });
      }
    }
    drawEar(earBack, -R * 0.6, -1);
    drawEar(earFront, R * 0.6, 1);

    const skull = new PIXI.Graphics();
    skull.circle(0, 0, R).fill({ color: B.coatHex })
      .stroke({ width: OUTW, color: OUT, alpha: 0.85 });
    if (B.id === 'corgi') {
      skull.ellipse(0, 1, 7, R * 0.92).fill({ color: B.bellyHex });          // 額頭白線
      skull.ellipse(0, R * 0.42, R * 0.62, R * 0.4).fill({ color: B.bellyHex });
    } else {
      skull.ellipse(0, R * 0.34, R * 0.78, R * 0.48).fill({ color: B.bellyHex }); // 臉頰奶油塊
      skull.circle(-R * 0.42, -R * 0.36, 3.4).fill({ color: B.bellyHex });        // 眉點
      skull.circle(R * 0.42, -R * 0.36, 3.4).fill({ color: B.bellyHex });
    }

    const face = new PIXI.Graphics();
    const eyes = new PIXI.Graphics();

    function drawFace() {
      face.clear();
      // 鼻
      face.ellipse(0, R * 0.18, 5, 3.8).fill({ color: P.noseHex });
      // 嘴：兩道小弧
      face.moveTo(0, R * 0.26).lineTo(0, R * 0.4)
        .stroke({ width: 1.8, color: OUT, alpha: 0.8, cap: 'round' });
      face.moveTo(-6.5, R * 0.52).quadraticCurveTo(-3, R * 0.34, 0, R * 0.42)
        .quadraticCurveTo(3, R * 0.34, 6.5, R * 0.52)
        .stroke({ width: 1.8, color: OUT, alpha: 0.8, cap: 'round' });
      // 腮紅
      face.ellipse(-R * 0.62, R * 0.3, 5.4, 3.2).fill({ color: P.blushHex, alpha: 0.6 });
      face.ellipse(R * 0.62, R * 0.3, 5.4, 3.2).fill({ color: P.blushHex, alpha: 0.6 });
    }
    drawFace();

    function drawEyes(open) {
      eyes.clear();
      if (open) {
        eyes.ellipse(-R * 0.38, -R * 0.1, 3.6, 4.2).fill({ color: P.noseHex });
        eyes.circle(-R * 0.32, -R * 0.22, 1.3).fill({ color: 0xffffff });
        eyes.ellipse(R * 0.38, -R * 0.1, 3.6, 4.2).fill({ color: P.noseHex });
        eyes.circle(R * 0.44, -R * 0.22, 1.3).fill({ color: 0xffffff });
      } else {
        eyes.moveTo(-R * 0.58, -R * 0.1).lineTo(-R * 0.18, -R * 0.1)
          .moveTo(R * 0.18, -R * 0.1).lineTo(R * 0.58, -R * 0.1)
          .stroke({ width: 2.3, color: P.noseHex, cap: 'round' });
      }
    }
    drawEyes(true);

    head.addChild(earBack, earFront, skull, face, eyes);
    rig.addChild(shadow, badge, head);

    let collarHex = D.COPY.collarColors[0].hex;
    function drawBadge() {
      // 正圓徽章，圓心就是定位點 —— 介面層的定位環才框得準
      badge.clear();
      badge.circle(0, 0, BADGE).fill({ color: P.creamHex, alpha: 0.96 });
      badge.circle(0, 0, BADGE).stroke({ width: 3.5, color: collarHex, alpha: 0.95 });
      badge.circle(0, BADGE - 1, 4.5).fill({ color: collarHex });   // 項圈牌
    }
    function setCollarColor(hex) { collarHex = hex; drawBadge(); }
    drawBadge();

    let blinkTimer = 1.6 + Math.random() * 3;
    let blinking = 0;

    return {
      view: root,
      breed: B,
      setCollarColor,
      /** speed 0..1；facing 1/-1（頭像只用來決定往哪邊歪一點）。 */
      update(dt, speed, facing, reduced) {
        if (reduced) {
          head.y = 0; head.rotation = 0; rig.y = 0;
          drawEyes(true);
          return;
        }
        const t = performance.now() * 0.001;
        // 走路時整顆 pin 輕輕上下彈；停下來只剩呼吸
        const bounce = Math.sin(t * (4 + speed * 9)) * (1.2 + speed * 4);
        rig.y = -Math.abs(bounce) * 0.6;      // 注意：位移只作用在 rig，root.y 屬於 map-scene
        head.y = bounce * 0.18;
        head.rotation = Math.sin(t * 1.7) * 0.05 + facing * speed * 0.09;
        const squash = 1 + Math.sin(t * (8 + speed * 10)) * 0.02 * (0.5 + speed);
        head.scale.set(1 / squash, squash);

        blinkTimer -= dt;
        if (blinkTimer <= 0) { blinking = 0.14; blinkTimer = 2.2 + Math.random() * 3.2; }
        if (blinking > 0) { blinking -= dt; drawEyes(false); } else { drawEyes(true); }
      },
    };
  }

  window.HALO = Object.assign(window.HALO || {}, { createDog });
})();
