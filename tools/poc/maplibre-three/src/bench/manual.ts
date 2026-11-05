// 手动检查页的链接：相机参数和 tools/lib/scenes.mjs 的场景相同
import manifest from '../manifest.json';
import models from '../models.json';

interface Item {
  readonly title: string;
  readonly hint: string;
  readonly links: readonly (readonly [string, string])[];
}

const { lng, lat, height, heading } = manifest.models[0].spawn as { lng: number; lat: number; height: number; heading: number };
const eye = encodeURIComponent([lng, lat, height + 1.6, heading, 0].join(','));
const white = encodeURIComponent(models.white.center.join(','));

const ITEMS: readonly Item[] = [
  {
    title: '第一人称手感',
    hint: 'WASD 走、左键拖动转头。只挪相机，不做碰撞，看相机本身跟不跟手、有没有抖动和穿模。',
    links: [
      ['方案 C，地图相机（模型抬高 20 米）', `/bench-c.html?models=station&eye=${eye}&fovy=60&lift=20&walk=1`],
      ['方案 C，独立 Three 场景', '/roam.html'],
      ['Cesium（真实的钻地设置）', `/bench-cesium.html?models=station&eye=${eye}&fovy=60&underground=1&walk=1`]
    ]
  },
  {
    title: 'z12 上下模型的出现方式',
    hint: '滚轮在 z13 和 z11 之间来回缩放，看模型怎样出现和消失，有没有错位。',
    links: [
      ['方案 C', `/bench-c.html?models=white&center=${white}&zoom=13&pitch=45`],
      ['Cesium', `/bench-cesium.html?models=white&center=${white}&zoom=13&pitch=45`]
    ]
  },
  {
    title: '转动时泼溅是否闪烁，亮处是否偏白',
    hint: '地图页按住右键转动，看高斯的前后顺序有没有闪烁。亮处看浅色墙面和地面，独立页面没有地图，可以作为对比。',
    links: [
      ['LCC2，地图里', '/lcc2app/map.html?bench=1&budget=3000000&zoom=18.5&pitch=60'],
      ['LCC2，独立页面', '/lcc2app/index.html?budget=3000000']
    ]
  },
  {
    title: '模型和天地图目测对齐',
    hint: '放大到 z18 以上，看建筑的底边和影像是否重合。构建前要在 .env.local 里配 VITE_TIANDITU_KEY，没有时页面用 ArcGIS 影像。',
    links: [['方案 C，带天地图的测试页', '/index.html?layer=own&tf=corrected&models=white,station&zoom=17']]
  }
];

const container = document.querySelector('#items');
for (const item of ITEMS) {
  const heading2 = document.createElement('h2');
  heading2.textContent = item.title;
  const hint = document.createElement('p');
  hint.textContent = item.hint;
  const list = document.createElement('ul');
  for (const [label, href] of item.links) {
    const entry = document.createElement('li');
    const link = document.createElement('a');
    link.textContent = label;
    link.href = href;
    link.target = '_blank';
    entry.append(link);
    list.append(entry);
  }
  container?.append(heading2, hint, list);
}
