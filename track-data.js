(function () {
'use strict';
/* track-data.js — HALO 智慧寵物追蹤器 demo 的單一事實來源。
 *
 * 一天的軌跡（06:00 → 22:00）以「控制點」形式描述：世界座標 (x, z) 走在
 * 城市網格上，t 是當天的分鐘數。map-scene.js 把它平滑成路徑畫在地圖上，
 * ui-layer.js 用同一組點畫時間軸標記與游標時間泡泡。
 *
 * 世界尺度：城市平面 240 × 240，道路每 24 單位一條，原點是市中心。
 * 家在西南街廓，公園在東北。安全圍欄以家為圓心。
 */

const CITY = {
  size: 240,          // 地面邊長
  block: 24,          // 街廓 / 道路間距
  homeRadius: 74,     // 預設安全圍欄半徑（世界單位；× METERS_PER_UNIT 才是公尺）
  fenceRadiusRange: [40, 112],
};

const HOME = { x: -72, z: 48 };
const PARK = { x: 54, z: -48 };

/** 把 06:00 起算的分鐘數格式化成 HH:MM。 */
function clock(minutes) {
  const m = Math.round(minutes);
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

const DAY_START = 6 * 60;   // 06:00
const DAY_END = 22 * 60;    // 22:00

/* 控制點：t 為當日分鐘（06:00 = 360）。
 * 每點可帶 label（時間軸上會標記）與 kind：
 *   home | walk | fence-exit | park | fence-return | rest
 */
const WAYPOINTS = [
  { t: 360, x: -72, z: 48, kind: 'home', label: '在家睡覺' },
  { t: 402, x: -72, z: 36, kind: 'home', label: '起床討飯' },
  { t: 447, x: -72, z: 24, kind: 'walk', label: '出門散步' },
  { t: 468, x: -48, z: 24, kind: 'walk' },
  { t: 486, x: -48, z: 0, kind: 'walk', label: '巷口早餐店' },
  { t: 510, x: -24, z: 0, kind: 'walk' },
  { t: 534, x: -24, z: -24, kind: 'fence-exit', label: '離開安全範圍' },
  { t: 558, x: 0, z: -24, kind: 'walk' },
  { t: 582, x: 24, z: -24, kind: 'walk' },
  { t: 600, x: 24, z: -48, kind: 'walk' },
  { t: 621, x: 48, z: -48, kind: 'park', label: '抵達河濱公園' },
  { t: 660, x: 60, z: -60, kind: 'park', label: '公園衝刺' },
  { t: 693, x: 66, z: -42, kind: 'park' },
  { t: 720, x: 48, z: -36, kind: 'park', label: '樹下乘涼' },
  { t: 756, x: 48, z: -24, kind: 'walk' },
  { t: 786, x: 24, z: -24, kind: 'walk' },
  { t: 813, x: 24, z: 0, kind: 'walk' },
  { t: 840, x: 0, z: 0, kind: 'walk' },
  { t: 864, x: -24, z: 0, kind: 'fence-return', label: '回到安全範圍' },
  { t: 891, x: -24, z: 24, kind: 'walk', label: '公車站等主人' },
  { t: 921, x: -48, z: 24, kind: 'walk' },
  { t: 951, x: -48, z: 48, kind: 'walk' },
  { t: 975, x: -72, z: 48, kind: 'home', label: '到家' },
  { t: 1050, x: -72, z: 54, kind: 'rest', label: '晚餐後趴著' },
  { t: 1200, x: -78, z: 50, kind: 'rest' },
  { t: 1320, x: -72, z: 48, kind: 'rest', label: '睡了' },
];

/** 距離（世界單位）→ 顯示用公尺。1 世界單位 = 12 公尺。 */
const METERS_PER_UNIT = 12;

/** 圍欄事件：demo 的招牌時刻，由 fence-exit 那點觸發。 */
const FENCE_EVENT = {
  waypointIndex: WAYPOINTS.findIndex((w) => w.kind === 'fence-exit'),
  title: '越界告警',
  body: '離開安全範圍 08:54，警報 4 秒內推播到手機。',
};


/* ---- 大地色系（CSS 與 Pixi 共用同一組值）----
 * 日式扁平插畫的做法：平塗、無漸層、少量高彩度重點色。
 */
const PALETTE = {
  paperHex:  0xfbf3e6,   // 紙底
  block1Hex: 0xefe0c8,   // 街廓 A
  block2Hex: 0xe8d5b7,   // 街廓 B
  block3Hex: 0xdfc9a8,   // 街廓 C
  roadHex:   0xfdf8ef,   // 道路
  roofHex:   0xc4855a,   // 屋頂 / 窗點
  riverHex:  0xa9c4c0,   // 河
  parkHex:   0xcbd9ac,   // 公園草地
  treeHex:   0x7e9b5b,   // 樹
  treeShadeHex: 0x5f7a44,
  pondHex:   0x9dbdc4,
  trailHex:  0xc86b3c,   // 走過的軌跡
  pawHex:    0xa8643a,   // 腳印
  accentHex: 0xc86b3c,   // 品牌重點 / 告警
  successHex:0x7e9b5b,   // 安全範圍
  textHex:   0x3a2e25,
  subHex:    0x8a7460,
  shadowHex: 0x3a2e25,
  creamHex:  0xfdf6ea,
  noseHex:   0x3a2e25,
  blushHex:  0xe89a86,
  tagHex:    0xf0d9a8,
};

/* 原創生成的大頭插畫（本專案自有版權；載不到就退回向量頭像） */
const DOG_TEXTURES = {
  shiba: 'assets/shiba-head.png',
  corgi: 'assets/corgi-head.png',
};

/* 犬種：柴犬 / 柯基，兩套形狀參數餵給同一組骨架 */
const BREEDS = {
  shiba: {
    id: 'shiba', name: '柴犬',
    coatHex: 0xd99b52, coatDarkHex: 0xb87a3a, bellyHex: 0xfdf6ea,
    bodyW: 30, bodyH: 21, legH: 19, headR: 21, headX: 25, headY: -16,
    ear: 'triangle', tail: 'curl',
  },
  corgi: {
    id: 'corgi', name: '柯基',
    coatHex: 0xd98f45, coatDarkHex: 0xb56f2e, bellyHex: 0xfdf6ea,
    bodyW: 36, bodyH: 19, legH: 12, headR: 20, headX: 30, headY: -14,
    ear: 'round-up', tail: 'stub',
  },
};

/* ---- 頁面內容（產品故事 / 技術 / 規格 / 情境 / 信任 / CTA）---- */

const COPY = {
  brand: 'HALO',
  product: '智慧寵物追蹤器',
  heroTitle: '牠走多遠，\n你都知道牠在哪。',
  heroSub: 'LTE-M + GNSS 雙頻定位，每 4 秒回報一次。安全圍欄一畫，越界立刻推播。',

  chapters: [
    {
      id: 'morning',
      num: '01',
      kicker: '清晨 06:00',
      title: '一整天，從一條線開始',
      body: '項圈醒著的每一秒都在寫日誌。你看到的不是一個點，是一條可以往回捲的軌跡——今天牠去了哪、待了多久、什麼時候折返。',
      metricLabel: '回報頻率',
      metricValue: '4',
      metricUnit: '秒 / 次',
    },
    {
      id: 'fence',
      num: '02',
      kicker: '上午 08:54',
      title: '越界的那一秒',
      body: '安全圍欄不是畫在地圖上的裝飾。牠的鼻子越過那條線，項圈在裝置端就判定完成，警報走 LTE-M 低延遲通道，平均 3.8 秒進到你手機。',
      metricLabel: '告警延遲',
      metricValue: '3.8',
      metricUnit: '秒',
    },
    {
      id: 'park',
      num: '03',
      kicker: '中午 11:12',
      title: '公園那一段跑得最兇',
      body: '九軸慣性感測補足 GPS 的空隙，樹冠下、橋墩旁訊號被遮住的那幾十秒，軌跡不會斷成兩截。',
      metricLabel: '公園段距離',
      metricValue: '2.4',
      metricUnit: '公里',
    },
    {
      id: 'replay',
      num: '04',
      kicker: '任何時候',
      title: '回放：把游標放在路上',
      body: '整天的路徑都能回放。游標移到任一段，那個位置的抵達時間、停留長度、當下速度立刻標出來——走失時，這是最快縮小範圍的方式。',
      metricLabel: '軌跡保存',
      metricValue: '90',
      metricUnit: '天',
    },
  ],

  specs: [
    { k: '定位', v: 'GNSS（GPS/GLONASS/Galileo）+ LTE-M 基站輔助' },
    { k: '精度', v: '開闊地 ±2.5 m，市區 ±6 m' },
    { k: '續航', v: '一般模式 14 天 / 即時模式 26 小時' },
    { k: '防水', v: 'IP68，水下 1.5 m / 30 分鐘' },
    { k: '重量', v: '28 g（含矽膠底座）' },
    { k: '連線', v: 'LTE-M / NB-IoT，內建 eSIM' },
  ],

  scenarios: [
    { t: '日常散步', d: '圍欄設在住家半徑 500 m，牠自己跑出巷口就會通知。' },
    { t: '長途出遊', d: '即時模式每秒回報，露營區、海邊、山徑都能追。' },
    { t: '走失搜尋', d: '回放最後 6 小時軌跡，配合鄰近熱點縮小搜索圈。' },
  ],

  trust: [
    { n: '128,400+', d: '在線項圈' },
    { n: '99.2%', d: '告警送達率' },
    { n: '4.8 / 5', d: 'App Store 評分（12,904 則）' },
    { n: '2 年', d: '全球保固' },
  ],

  collarColors: [
    { id: 'caramel', name: '焦糖棕', hex: 0xa8643a, css: '#a8643a' },
    { id: 'matcha', name: '抹茶綠', hex: 0x7e9b5b, css: '#7e9b5b' },
    { id: 'terracotta', name: '陶土紅', hex: 0xc8563c, css: '#c8563c' },
    { id: 'indigo', name: '藍染靛', hex: 0x4a6b82, css: '#4a6b82' },
  ],

  cta: {
    label: '預購 HALO One',
    price: 'NT$ 3,480',
    note: '含 12 個月數據方案，首批 3 月 20 日出貨',
    confirmed: '已加入預購名單 — 我們會寄出貨通知',
  },
};

/* 全域命名空間：這份 demo 刻意不用打包器，直接雙擊 index.html 就能跑。 */
window.HALO = Object.assign(window.HALO || {}, {
  CITY, HOME, PARK, clock, DAY_START, DAY_END,
  WAYPOINTS, METERS_PER_UNIT, FENCE_EVENT, COPY, PALETTE, BREEDS, DOG_TEXTURES,
});

})();
