/* map-scene.js — PixiJS v8 世界層：大地色系手繪城市地圖 + 狗狗 Mochi。
 *
 * 全部是程序化 Graphics 畫的（沒有任何圖檔），所以：
 *   - 換色票就整張地圖跟著換，不用重出素材
 *   - 專案零資產、可直接雙擊 index.html 開
 *
 * 座標系：waypoint 的世界單位 × SCALE = 地圖像素。地圖原點在畫布中央，
 * 由 camera 容器負責平移縮放（等同 2D 版的鏡頭關鍵影格軌道）。
 */
(function () {
  'use strict';

  const D = window.HALO;
  const SCALE = 7;              // 世界單位 → 地圖像素
  const TAU = Math.PI * 2;

  const C = D.PALETTE;

  const wx = (x) => x * SCALE;
  const wz = (z) => z * SCALE;

  /* ---------- 平滑曲線：Catmull-Rom 取樣（不再依賴 Three） ---------- */
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  function buildPath(points, samplesPerSeg) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(n - 1, i + 2)];
      for (let s = 0; s < samplesPerSeg; s++) {
        const t = s / samplesPerSeg;
        // Catmull-Rom 給的是漂亮弧線，但會切過街廓；跟直線段折衷後
        // 轉角只留一點圓弧，路線貼著馬路走，又不像機器畫的直角。
        const cxp = catmull(p0.x, p1.x, p2.x, p3.x, t);
        const cyp = catmull(p0.y, p1.y, p2.y, p3.y, t);
        const lx = p1.x + (p2.x - p1.x) * t;
        const ly = p1.y + (p2.y - p1.y) * t;
        const K = 0.62;                       // 0 = 純曲線，1 = 純折線
        out.push({ x: cxp + (lx - cxp) * K, y: cyp + (ly - cyp) * K, seg: i, local: t });
      }
    }
    const last = points[n - 1];
    out.push({ x: last.x, y: last.y, seg: n - 2, local: 1 });
    // 累積弧長，之後才能用「距離」均勻取點
    let acc = 0;
    out[0].s = 0;
    for (let i = 1; i < out.length; i++) {
      acc += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
      out[i].s = acc;
    }
    out.total = acc;
    return out;
  }

  /** 種子亂數：地圖每次載入長一樣，截圖與測試可重現。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================
     地圖：分區、河堤、公園、街廓、道路 —— 一次畫完，之後只動 camera

     刻意分成兩張 Graphics：base（地與水與大色塊）與 detail（建物、
     行道樹、斑馬線、公園設施）。分開的好處是層次清楚，而且未來要做
     「只重畫細節層」的季節/日夜變體時不必動到地層。
     ================================================================ */
  function drawMap(base, detail, labels) {
    const rand = mulberry32(20260905);
    const half = (D.CITY.size / 2) * SCALE;
    const block = D.CITY.block * SCALE;
    const outer = half * 1.9;
    const parkX = wx(D.PARK.x), parkZ = wz(D.PARK.z), parkR = 34 * SCALE;

    /* ---------- 紙底 ---------- */
    base.rect(-half * 3, -half * 3, half * 6, half * 6).fill({ color: C.paperHex });

    /* ---------- 分區底色：幾團柔和色斑，整張圖才不會一片死板 ---------- */
    const districts = [
      { x: -outer * 0.55, y: -outer * 0.5, r: outer * 0.62, c: C.block2Hex, a: 0.5 },
      { x: outer * 0.5, y: outer * 0.45, r: outer * 0.7, c: C.block3Hex, a: 0.45 },
      { x: outer * 0.45, y: -outer * 0.6, r: outer * 0.5, c: C.block1Hex, a: 0.55 },
      { x: -outer * 0.6, y: outer * 0.55, r: outer * 0.55, c: C.block2Hex, a: 0.4 },
    ];
    districts.forEach((d) => base.circle(d.x, d.y, d.r).fill({ color: d.c, alpha: d.a }));

    /* ---------- 河與河堤 ---------- */
    // 河道中心線（之後橋、河堤步道都沿用這條）
    const river = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      river.push({
        x: -outer + outer * 2 * t,
        y: -outer * 0.72 + t * outer * 1.15 + Math.sin(t * 6.2) * outer * 0.12,
      });
    }
    const strokeRiver = (g, w, color, alpha) => {
      g.moveTo(river[0].x, river[0].y);
      for (let i = 1; i < river.length; i++) g.lineTo(river[i].x, river[i].y);
      g.stroke({ width: w, color, alpha, cap: 'round', join: 'round' });
    };
    strokeRiver(base, 86, C.parkHex, 0.75);          // 河堤綠地
    strokeRiver(base, 66, C.riverHex, 0.55);         // 淺灘
    strokeRiver(base, 48, C.riverHex, 1);            // 主河道
    // 水紋
    for (let i = 4; i < river.length - 4; i += 3) {
      const a = river[i], b = river[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const off = (rand() - 0.5) * 16;
      detail.moveTo(a.x + Math.cos(ang) * off - 7, a.y + Math.sin(ang) * off)
        .quadraticCurveTo(a.x + Math.cos(ang) * off, a.y + Math.sin(ang) * off - 4,
          a.x + Math.cos(ang) * off + 7, a.y + Math.sin(ang) * off);
    }
    detail.stroke({ width: 1.6, color: C.paperHex, alpha: 0.5, cap: 'round' });
    // 河堤步道：沿岸兩條細虛線
    [-40, 40].forEach((off) => {
      for (let i = 0; i < river.length - 1; i += 2) {
        const a = river[i], b = river[i + 1];
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
        detail.moveTo(a.x + Math.cos(ang) * off, a.y + Math.sin(ang) * off)
          .lineTo(b.x + Math.cos(ang) * off, b.y + Math.sin(ang) * off);
      }
    });
    detail.stroke({ width: 2.4, color: C.roadHex, alpha: 0.85, cap: 'round' });

    /** 某點是否落在河面上（畫街廓與樹時要避開） */
    function onRiver(x, y, pad) {
      for (let i = 0; i < river.length; i++) {
        if (Math.hypot(river[i].x - x, river[i].y - y) < 52 + pad) return true;
      }
      return false;
    }

    /* ---------- 公園：草地 + 步道 + 池塘 + 遊具 + 樹叢 ---------- */
    base.circle(parkX, parkZ, parkR).fill({ color: C.parkHex });
    base.circle(parkX - parkR * 0.3, parkZ + parkR * 0.35, parkR * 0.55)
      .fill({ color: C.treeHex, alpha: 0.18 });

    // 園內步道：兩條交叉曲線
    detail.moveTo(parkX - parkR, parkZ + parkR * 0.2)
      .quadraticCurveTo(parkX, parkZ - parkR * 0.5, parkX + parkR, parkZ - parkR * 0.1);
    detail.moveTo(parkX - parkR * 0.5, parkZ - parkR * 0.85)
      .quadraticCurveTo(parkX + parkR * 0.1, parkZ, parkX - parkR * 0.2, parkZ + parkR * 0.9);
    detail.stroke({ width: 7, color: C.roadHex, alpha: 0.9, cap: 'round' });

    // 池塘 + 睡蓮
    const pondX = parkX + parkR * 0.42, pondY = parkZ + parkR * 0.4;
    detail.ellipse(pondX, pondY, 52, 36).fill({ color: C.pondHex });
    detail.ellipse(pondX, pondY, 52, 36).stroke({ width: 3, color: C.treeHex, alpha: 0.35 });
    for (let i = 0; i < 5; i++) {
      detail.circle(pondX - 30 + rand() * 60, pondY - 18 + rand() * 36, 4 + rand() * 3)
        .fill({ color: C.treeHex, alpha: 0.55 });
    }

    // 遊具區：沙色圓場 + 幾個小圈
    const playX = parkX - parkR * 0.5, playY = parkZ - parkR * 0.35;
    detail.circle(playX, playY, 34).fill({ color: C.block3Hex, alpha: 0.9 });
    detail.circle(playX, playY, 34).stroke({ width: 2.5, color: C.roofHex, alpha: 0.4 });
    detail.circle(playX - 10, playY - 6, 6).fill({ color: C.accentHex, alpha: 0.8 });
    detail.circle(playX + 12, playY + 8, 5).fill({ color: C.riverHex });
    detail.roundRect(playX - 4, playY + 8, 18, 6, 3).fill({ color: C.roofHex, alpha: 0.75 });

    // 樹叢（大小交錯，帶陰影）
    for (let i = 0; i < 44; i++) {
      const a = rand() * TAU;
      const r = 30 + rand() * (parkR - 40);
      const tx = parkX + Math.cos(a) * r;
      const ty = parkZ + Math.sin(a) * r;
      if (Math.hypot(tx - pondX, ty - pondY) < 62) continue;
      const rr = 8 + rand() * 8;
      detail.circle(tx + 2, ty + 4, rr).fill({ color: C.treeShadeHex, alpha: 0.35 });
      detail.circle(tx, ty, rr).fill({ color: C.treeHex });
      detail.circle(tx - rr * 0.3, ty - rr * 0.3, rr * 0.45).fill({ color: C.parkHex, alpha: 0.5 });
    }

    /* ---------- 街廓：依類型畫不同內容 ---------- */
    const roofTones = [C.roofHex, 0xb08050, 0xa8643a, 0x8f9d76];
    for (let x = -outer; x < outer; x += block) {
      for (let z = -outer; z < outer; z += block) {
        const cx = x + block / 2, cz = z + block / 2;
        if (Math.hypot(cx - parkX, cz - parkZ) < parkR + 16) continue;
        if (onRiver(cx, cz, 10)) continue;

        const pad = 14 + rand() * 8;
        const bx = x + pad, bz = z + pad;
        const bw = block - pad * 2, bh = block - pad * 2;
        const roll = rand();

        if (roll < 0.12) {
          /* 學校：操場跑道 + 校舍 */
          base.roundRect(bx, bz, bw, bh, 12).fill({ color: C.parkHex, alpha: 0.85 });
          detail.ellipse(bx + bw * 0.55, bz + bh * 0.55, bw * 0.3, bh * 0.22)
            .stroke({ width: 4, color: C.roadHex, alpha: 0.95 });
          detail.roundRect(bx + 6, bz + 6, bw * 0.42, bh * 0.3, 5)
            .fill({ color: C.creamHex }).stroke({ width: 2, color: C.roofHex, alpha: 0.5 });
        } else if (roll < 0.2) {
          /* 停車場：斜線車位 */
          base.roundRect(bx, bz, bw, bh, 10).fill({ color: C.block3Hex });
          for (let k = 1; k < 5; k++) {
            detail.moveTo(bx + (bw / 5) * k, bz + 8).lineTo(bx + (bw / 5) * k, bz + bh - 8);
          }
          detail.stroke({ width: 2, color: C.paperHex, alpha: 0.85 });
        } else if (roll < 0.3) {
          /* 市場 / 廣場：棚架色條 */
          base.roundRect(bx, bz, bw, bh, 10).fill({ color: C.block1Hex });
          for (let k = 0; k < 4; k++) {
            detail.roundRect(bx + 8, bz + 10 + k * (bh - 20) / 4, bw - 16, 7, 3)
              .fill({ color: roofTones[k % roofTones.length], alpha: 0.7 });
          }
        } else if (roll < 0.42) {
          /* 綠地小公園：草地 + 幾棵樹 */
          base.roundRect(bx, bz, bw, bh, 14).fill({ color: C.parkHex, alpha: 0.9 });
          for (let k = 0; k < 4; k++) {
            const tx = bx + 12 + rand() * (bw - 24);
            const ty = bz + 12 + rand() * (bh - 24);
            detail.circle(tx + 1.5, ty + 3, 7).fill({ color: C.treeShadeHex, alpha: 0.3 });
            detail.circle(tx, ty, 7).fill({ color: C.treeHex });
          }
        } else {
          /* 一般住商街廓：2–4 棟房子 + 院子 */
          base.roundRect(bx, bz, bw, bh, 10).fill({ color: C.block2Hex });
          const houses = 2 + Math.floor(rand() * 3);
          for (let k = 0; k < houses; k++) {
            const hw = bw * (0.28 + rand() * 0.3);
            const hh = bh * (0.26 + rand() * 0.3);
            const hxp = bx + 6 + rand() * (bw - hw - 12);
            const hyp = bz + 6 + rand() * (bh - hh - 12);
            detail.roundRect(hxp + 2, hyp + 3, hw, hh, 4).fill({ color: C.shadowHex, alpha: 0.08 });
            detail.roundRect(hxp, hyp, hw, hh, 4).fill({ color: C.creamHex });
            detail.roundRect(hxp, hyp, hw, hh * 0.42, 4)
              .fill({ color: roofTones[Math.floor(rand() * roofTones.length)], alpha: 0.9 });
            // 窗
            detail.circle(hxp + hw * 0.3, hyp + hh * 0.72, 2).fill({ color: C.roofHex, alpha: 0.5 });
            detail.circle(hxp + hw * 0.7, hyp + hh * 0.72, 2).fill({ color: C.roofHex, alpha: 0.5 });
          }
        }
      }
    }

    /* ---------- 道路：主幹道（寬＋中線）與巷弄（細） ---------- */
    const isAvenue = (v) => Math.round(v / block) % 2 === 0;
    for (let v = -outer; v <= outer; v += block) {
      const g2 = base;
      const w = isAvenue(v) ? 20 : 12;
      g2.moveTo(-outer, v).lineTo(outer, v).stroke({ width: w, color: C.roadHex, alpha: 0.95, cap: 'round' });
      g2.moveTo(v, -outer).lineTo(v, outer).stroke({ width: w, color: C.roadHex, alpha: 0.95, cap: 'round' });
    }
    // 主幹道中線（虛線）
    for (let v = -outer; v <= outer; v += block) {
      if (!isAvenue(v)) continue;
      for (let s = -outer; s < outer; s += 34) {
        detail.moveTo(s, v).lineTo(s + 18, v);
        detail.moveTo(v, s).lineTo(v, s + 18);
      }
    }
    detail.stroke({ width: 1.8, color: C.roofHex, alpha: 0.28 });

    // 斑馬線：主幹道交叉口
    for (let vx = -outer; vx <= outer; vx += block) {
      if (!isAvenue(vx)) continue;
      for (let vy = -outer; vy <= outer; vy += block) {
        if (!isAvenue(vy)) continue;
        if (Math.hypot(vx - parkX, vy - parkZ) < parkR) continue;
        for (let k = -2; k <= 2; k++) {
          detail.roundRect(vx + k * 5 - 1.6, vy + 13, 3.2, 11, 1.5)
            .fill({ color: C.paperHex, alpha: 0.85 });
          detail.roundRect(vx + 13, vy + k * 5 - 1.6, 11, 3.2, 1.5)
            .fill({ color: C.paperHex, alpha: 0.85 });
        }
      }
    }

    // 行道樹：沿主幹道等距種
    for (let v = -outer; v <= outer; v += block) {
      if (!isAvenue(v)) continue;
      for (let s = -outer; s < outer; s += 52) {
        [[s, v - 17], [s, v + 17], [v - 17, s], [v + 17, s]].forEach(([tx, ty]) => {
          if (Math.hypot(tx - parkX, ty - parkZ) < parkR) return;
          if (onRiver(tx, ty, 0)) return;
          if (rand() > 0.55) return;
          detail.circle(tx, ty, 5).fill({ color: C.treeHex, alpha: 0.9 });
        });
      }
    }

    /* ---------- 橋：道路與河交會處 ---------- */
    river.forEach((pt, i) => {
      if (i % 8 !== 0) return;
      const nearest = Math.round(pt.x / block) * block;
      if (Math.abs(nearest - pt.x) > 12) return;
      detail.roundRect(nearest - 16, pt.y - 34, 32, 68, 6)
        .fill({ color: C.roadHex, alpha: 0.98 })
        .stroke({ width: 2.5, color: C.roofHex, alpha: 0.5 });
    });

    /* ---------- 家 ---------- */
    const hx = wx(D.HOME.x), hz = wz(D.HOME.z);
    detail.circle(hx, hz, 46).fill({ color: C.parkHex, alpha: 0.55 });   // 前院
    detail.roundRect(hx - 26, hz - 12, 52, 40, 6).fill({ color: C.creamHex })
      .stroke({ width: 2.4, color: C.roofHex, alpha: 0.55 });
    detail.moveTo(hx - 34, hz - 10).lineTo(hx, hz - 42).lineTo(hx + 34, hz - 10).closePath()
      .fill({ color: C.roofHex });
    detail.roundRect(hx - 8, hz + 8, 16, 20, 3).fill({ color: C.roofHex, alpha: 0.75 });
    detail.circle(hx - 5, hz - 6, 4).fill({ color: C.accentHex });
    detail.circle(hx + 5, hz - 6, 4).fill({ color: C.accentHex });
    detail.moveTo(hx - 8.5, hz - 4).lineTo(hx, hz + 3).lineTo(hx + 8.5, hz - 4).closePath()
      .fill({ color: C.accentHex });

    /* ---------- 地名 ---------- */
    const mk = (text, x, y, size, alpha) => {
      const t = new PIXI.Text({
        text,
        style: {
          fontFamily: '"Noto Sans TC", system-ui, sans-serif',
          fontSize: size, fontWeight: '700', fill: C.textHex, align: 'center',
        },
      });
      t.anchor.set(0.5);
      t.position.set(x, y);
      t.alpha = alpha;
      labels.addChild(t);
    };
    mk('家', hx, hz - 64, 26, 0.85);
    mk('河濱公園', parkX, parkZ - parkR - 26, 26, 0.8);
    mk('河堤步道', river[10].x, river[10].y - 62, 20, 0.6);
    mk('早餐店', wx(-48), wz(0) - 30, 18, 0.55);
    mk('公車站', wx(-24), wz(24) - 30, 18, 0.55);
  }


  /* ================================================================
     對外：建立世界層
     ================================================================ */
  function createMap(app) {
    const camera = new PIXI.Container();      // 鏡頭：平移 + 縮放
    camera.sortableChildren = true;
    app.stage.addChild(camera);

    const mapG = new PIXI.Graphics();      // 地層：地、水、大色塊、道路
    const detailG = new PIXI.Graphics();   // 細節層：建物、行道樹、斑馬線、公園設施
    const labels = new PIXI.Container();
    const fenceG = new PIXI.Graphics();
    const trailG = new PIXI.Graphics();
    const pawG = new PIXI.Graphics();
    const eventG = new PIXI.Graphics();
    mapG.zIndex = 0; detailG.zIndex = 0.5; labels.zIndex = 1; fenceG.zIndex = 2;
    trailG.zIndex = 3; pawG.zIndex = 4; eventG.zIndex = 5;
    camera.addChild(mapG, detailG, labels, fenceG, trailG, pawG, eventG);

    drawMap(mapG, detailG, labels);

    let dog = D.createDog('shiba');
    dog.view.zIndex = 10;
    camera.addChild(dog.view);

    /* 路徑取樣 */
    const rawPts = D.WAYPOINTS.map((w) => ({ x: wx(w.x), y: wz(w.z) }));
    const path = buildPath(rawPts, 24);

    /* 事件圖釘（離開/回到安全範圍、公園…）畫一次 */
    D.WAYPOINTS.forEach((w) => {
      if (!w.label) return;
      const x = wx(w.x), y = wz(w.z);
      const isFence = w.kind === 'fence-exit' || w.kind === 'fence-return';
      const col = isFence ? C.accentHex : C.subHex;
      eventG.circle(x, y, 7).fill({ color: C.paperHex });
      eventG.circle(x, y, 7).stroke({ width: 2.5, color: col });
      if (isFence) eventG.circle(x, y, 3).fill({ color: col });
    });

    /** 當日分鐘 → path 索引（用 waypoint 時間戳做分段內插）。 */
    function timeToIndex(minutes) {
      const wps = D.WAYPOINTS;
      const n = wps.length - 1;
      let seg = 0, local = 0;
      if (minutes <= wps[0].t) { seg = 0; local = 0; }
      else if (minutes >= wps[n].t) { seg = n - 1; local = 1; }
      else {
        for (let i = 0; i < n; i++) {
          if (minutes <= wps[i + 1].t) {
            seg = i;
            local = (minutes - wps[i].t) / (wps[i + 1].t - wps[i].t);
            break;
          }
        }
      }
      const perSeg = 24;
      return Math.min(path.length - 1, seg * perSeg + local * perSeg);
    }

    /** path 索引 → 當日分鐘（hover 回放用）。 */
    function indexToTime(idx) {
      const perSeg = 24;
      const seg = Math.min(D.WAYPOINTS.length - 2, Math.floor(idx / perSeg));
      const local = Math.min(1, (idx - seg * perSeg) / perSeg);
      const a = D.WAYPOINTS[seg], b = D.WAYPOINTS[seg + 1];
      return a.t + (b.t - a.t) * local;
    }

    function pointAt(idx) {
      const i = Math.max(0, Math.min(path.length - 1, idx));
      const i0 = Math.floor(i), i1 = Math.min(path.length - 1, i0 + 1);
      const f = i - i0;
      return {
        x: path[i0].x + (path[i1].x - path[i0].x) * f,
        y: path[i0].y + (path[i1].y - path[i0].y) * f,
      };
    }

    /* ---- 鏡頭關鍵影格：捲動進度 → 縮放（位置永遠跟著狗） ---- */
    const ZOOM_TRACK = [
      { at: 0.00, zoom: 0.62 },
      { at: 0.18, zoom: 1.00 },
      { at: 0.42, zoom: 1.22 },   // 越界那段拉近
      { at: 0.60, zoom: 0.95 },
      { at: 0.80, zoom: 0.70 },   // 拉遠看整天
      { at: 1.00, zoom: 0.58 },
    ];
    function sampleZoom(p) {
      let i = 0;
      while (i < ZOOM_TRACK.length - 2 && p > ZOOM_TRACK[i + 1].at) i++;
      const a = ZOOM_TRACK[i], b = ZOOM_TRACK[i + 1];
      const t = Math.max(0, Math.min(1, (p - a.at) / (b.at - a.at)));
      const e = t * t * (3 - 2 * t);
      return a.zoom + (b.zoom - a.zoom) * e;
    }

    const camPos = { x: 0, y: 0, zoom: 0.62 };
    let lastIdx = 0;

    const api = {
      camera, path, pointAt, timeToIndex, indexToTime,
      dogWorld: { x: 0, y: 0 },
      dogScreen: { x: 0, y: 0 },
      homeWorld: { x: wx(D.HOME.x), y: wz(D.HOME.z) },
      distanceFromHome: 0,
      breached: false,
      fenceRadius: D.CITY.homeRadius,
      collarHex: D.COPY.collarColors[0].hex,
      setCollarColor(hex) { api.collarHex = hex; dog.setCollarColor(hex); },
      /** 換犬種：整隻重畫（形狀參數不同），位置與項圈顏色沿用。 */
      setBreed(breedId) {
        const old = dog;
        dog = D.createDog(breedId);
        dog.view.zIndex = 10;
        dog.view.position.copyFrom(old.view.position);
        dog.setCollarColor(api.collarHex);
        camera.addChild(dog.view);
        camera.removeChild(old.view);
        old.view.destroy({ children: true });
        api.breed = breedId;
      },
      breed: 'shiba',
      setFenceRadius(r) { api.fenceRadius = r; },

      /** 地圖座標 → 螢幕座標（UI 層用）。 */
      toScreen(x, y) {
        return {
          x: camera.x + x * camera.scale.x,
          y: camera.y + y * camera.scale.y,
        };
      },
      /** 螢幕座標 → 地圖座標（hover 命中用）。 */
      toWorld(x, y) {
        return {
          x: (x - camera.x) / camera.scale.x,
          y: (y - camera.y) / camera.scale.y,
        };
      },

      update(state, dt) {
        const idx = timeToIndex(state.timeMinutes);
        const p = pointAt(idx);
        const prev = pointAt(Math.max(0, idx - 0.6));
        const dx = p.x - prev.x;
        const speedPx = Math.hypot(dx, p.y - prev.y);
        const speed = Math.max(0, Math.min(1, speedPx / 26));

        dog.view.position.set(p.x, p.y);
        dog.update(dt, speed, dx >= 0 ? 1 : -1, state.reducedMotion);
        api.dogWorld.x = p.x;
        api.dogWorld.y = p.y;

        /* 走過的軌跡：只在索引前進時重畫（Graphics 不該每幀重建） */
        if (Math.abs(idx - lastIdx) > 0.35) {
          lastIdx = idx;
          trailG.clear();
          const upto = Math.floor(idx);
          if (upto > 0) {
            trailG.moveTo(path[0].x, path[0].y);
            for (let i = 1; i <= upto; i++) trailG.lineTo(path[i].x, path[i].y);
            trailG.lineTo(p.x, p.y);
            trailG.stroke({ width: 7, color: C.trailHex, alpha: 0.9, cap: 'round', join: 'round' });
          }
          /* 腳印：每 14 個取樣蓋一個，交錯左右 */
          pawG.clear();
          for (let i = 6; i <= upto; i += 14) {
            const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const side = (i / 14) % 2 === 0 ? 1 : -1;
            const ox = Math.cos(ang + Math.PI / 2) * 7 * side;
            const oy = Math.sin(ang + Math.PI / 2) * 7 * side;
            pawG.circle(a.x + ox, a.y + oy, 3.4).fill({ color: C.pawHex, alpha: 0.55 });
            for (let k = -1; k <= 1; k++) {
              pawG.circle(
                a.x + ox + Math.cos(ang + k * 0.8) * 5.4,
                a.y + oy + Math.sin(ang + k * 0.8) * 5.4,
                1.7
              ).fill({ color: C.pawHex, alpha: 0.45 });
            }
          }
        }

        /* 安全圍欄：虛線圓 + 呼吸 */
        const R = api.fenceRadius * SCALE;
        const dist = Math.hypot(p.x - api.homeWorld.x, p.y - api.homeWorld.y);
        api.distanceFromHome = dist / SCALE;
        api.breached = dist > R;

        fenceG.clear();
        const fenceCol = api.breached ? C.accentHex : C.successHex;
        const beat = state.reducedMotion ? 0.5 : (Math.sin(performance.now() * 0.0022) * 0.5 + 0.5);
        fenceG.circle(api.homeWorld.x, api.homeWorld.y, R)
          .fill({ color: fenceCol, alpha: api.breached ? 0.07 + beat * 0.04 : 0.05 });
        const SEGS = 88;
        const phase = state.reducedMotion ? 0 : (performance.now() * 0.00016) % 1;
        for (let i = 0; i < SEGS; i++) {
          if ((i + Math.floor(phase * 4)) % 4 >= 2) continue;
          const a0 = (i / SEGS) * TAU;
          const a1 = ((i + 1) / SEGS) * TAU;
          fenceG.moveTo(api.homeWorld.x + Math.cos(a0) * R, api.homeWorld.y + Math.sin(a0) * R);
          fenceG.arc(api.homeWorld.x, api.homeWorld.y, R, a0, a1);
        }
        fenceG.stroke({
          width: api.breached ? 5 : 3.5,
          color: fenceCol,
          alpha: api.breached ? 0.95 : 0.7,
          cap: 'round',
        });

        /* 鏡頭：位置永遠追狗，縮放走關鍵影格；阻尼在這裡收斂 */
        const targetZoom = sampleZoom(state.scrollProgress) * state.viewScale;
        const damp = state.reducedMotion ? 1 : 1 - Math.exp(-4.5 * dt);
        camPos.zoom += (targetZoom - camPos.zoom) * damp;

        // 鏡頭對準 stage 中心 —— 文字佔掉的那一側完全不參與構圖，
        // 所以狗永遠不會跑到文案底下。
        const st = state.stage;
        const cx = st.x + st.w * 0.5 + state.parallax.x * 22;
        const cy = st.y + st.h * 0.5 + state.parallax.y * 16;
        const tx = cx - p.x * camPos.zoom;
        const ty = cy - p.y * camPos.zoom;
        camPos.x += (tx - camPos.x) * damp;
        camPos.y += (ty - camPos.y) * damp;

        camera.scale.set(camPos.zoom);
        camera.position.set(camPos.x, camPos.y);

        const s = api.toScreen(p.x, p.y);
        api.dogScreen.x = s.x;
        api.dogScreen.y = s.y;
      },
    };

    return api;
  }

  window.HALO = Object.assign(window.HALO || {}, { createMap, SCALE });
})();
