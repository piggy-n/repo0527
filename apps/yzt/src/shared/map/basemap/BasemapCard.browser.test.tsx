import 'element-plus/dist/index.css';
import { provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { defineComponent, nextTick } from 'vue';
import type { ServerBasemapId } from '../../config/server-basemap-options';
import { required } from '../../testing/required';
import { JIANGSU_CAMERA } from '../jiangsu';
import type { BasemapId } from './basemap-style';
import { BasemapCard } from './BasemapCard';
import { BAKED_LABELS_HINT } from './BasemapPanel';
import type { ServerBasemaps } from './server-basemaps';
import { type Basemap, useBasemap } from './useBasemap';

// 真实的布局（ADR 0040）：浮层的高、名称会不会折行、用的什么字体，jsdom 里量不出来

// 用到的令牌由 app 的样式给出，这里直接写出；正文字体同 app（fonts.scss、base.scss），文件在不入库的 public/fonts/
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--font-size-xs': '12px',
  '--line-height-tag': '16px',
  '--font-weight-semibold': '600',
  '--radius-sm': '4px',
  '--radius-md': '8px',
  '--font-family-base': "'Alibaba PuHuiTi', 'Microsoft YaHei', sans-serif"
};
const STYLES = [
  `:root { ${Object.entries(TOKENS).map(([key, value]) => `${key}: ${value};`).join(' ')} }`,
  "@font-face { font-family: 'Alibaba PuHuiTi'; font-weight: 400; src: url('/fonts/AlibabaPuHuiTi-3-55-Regular.woff2'); }",
  "@font-face { font-family: 'Alibaba PuHuiTi'; font-weight: 600; src: url('/fonts/AlibabaPuHuiTi-3-75-SemiBold.woff2'); }",
  'body { margin: 0; font-family: var(--font-family-base); }'
].join('\n');

// 一个像素的 PNG：探测读到的瓦片
const TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const servers = (...ids: ServerBasemapId[]): ServerBasemaps =>
  ids.map(id => ({ id, root: `http://intranet.test/basemap/${id}/`, thumbnail: TILE }));
const ALL_FOUR = servers('standard', 'imagery', 'black', 'night-blue');

// 浮层宽 min(320, 视口 - 112)：常规、390 和 360 的手机（local/design/intranet-basemap/DESIGN.md）
const VIEWPORTS = [
  [1280, 320],
  [390, 278],
  [360, 248]
] as const;

// 和页面一样贴着视口的右下角，浮层一开始就打开
function setup(found: ServerBasemaps) {
  const host = document.body.appendChild(document.createElement('div'));
  let owner: Basemap | undefined;
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: JIANGSU_CAMERA });
    const basemap = useBasemap({ tianditu: null, servers: found });
    owner = basemap;
    return () => (
      <div style={{ position: 'fixed', right: '16px', bottom: '16px' }}>
        <BasemapCard basemap={basemap} open />
      </div>
    );
  });
  const wrapper = mount(Page, { attachTo: host });
  return {
    basemap: required(owner, '底图的拥有者'),
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 等字体、浮层放好以后的一帧
async function settle() {
  await vi.waitFor(() => expect(document.querySelector('[data-map-options="basemap"]')).not.toBeNull());
  await document.fonts.ready;
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
}

async function open(found: ServerBasemaps, viewport: number, selected?: BasemapId) {
  await page.viewport(viewport, 800);
  const ctx = setup(found);
  if (selected) {
    ctx.basemap.select(selected);
  }
  await settle();
  return ctx;
}

const content = () => required(document.querySelector<HTMLElement>('[data-map-options="basemap"]'), '底图浮层');
const popper = () => required(content().closest<HTMLElement>('.el-popper'), 'Element 的弹出层');
const card = () => required(document.querySelector('button[aria-label^="底图："]'), '底图卡');

async function expand() {
  required(content().querySelector<HTMLButtonElement>('button[aria-label="调整标注和透明度"]'), '入口').click();
  await settle();
}

// 缩略图的名称是框里最后一个元素
const thumbnailLabels = () =>
  [...content().querySelectorAll('[role="group"] button[aria-label$="底图"]')].map(button => {
    const frame = required(button.firstElementChild, '缩略图的框');
    return { label: required(frame.lastElementChild, '缩略图的名称'), frame };
  });

// 名称叠在右下角：自己的高（一行 16 加上下各 2）、放不下的宽、有没有伸出缩略图的左边
function labelBox(label: Element, frame: Element) {
  if (!(label instanceof HTMLElement)) {
    throw new Error('名称不是元素');
  }
  return {
    text: label.textContent,
    height: label.offsetHeight,
    overflow: label.scrollWidth - label.clientWidth,
    inside: label.getBoundingClientRect().left >= frame.getBoundingClientRect().left
  };
}

const fitting = (texts: readonly string[]) => texts.map(text => ({ text, height: 20, overflow: 0, inside: true }));

// 标注一行中间的说明：没有时为 null
function hintBox() {
  const hint = [...content().querySelectorAll('span')].find(span => span.textContent === BAKED_LABELS_HINT);
  return hint ? { height: hint.offsetHeight, overflow: hint.scrollWidth - hint.clientWidth } : null;
}

describe('底图卡和浮层（真实布局）', () => {
  const style = document.createElement('style');
  beforeAll(() => {
    style.textContent = STYLES;
    document.head.append(style);
  });
  afterAll(() => style.remove());
  afterEach(async () => {
    document.body.innerHTML = '';
    await page.viewport(1280, 800);
  });

  const LAYOUTS = [
    ['都没有', servers(), ['静态', '无底图'], 86],
    ['只有影像', servers('imagery'), ['影像', '静态', '无底图'], 86],
    ['只有黑色、极夜蓝', servers('black', 'night-blue'), ['静态', '黑色', '极夜蓝', '无底图'], 158],
    ['四套都有', ALL_FOUR, ['标准', '影像', '静态', '黑色', '极夜蓝', '无底图'], 158]
  ] as const;

  it.for(
    VIEWPORTS.flatMap(([viewport, width]) =>
      LAYOUTS.map(([name, found, texts, height]) => [viewport, width, name, found, texts, height] as const)
    )
  )(
    '%s 宽的视口（浮层 %s），%s：收起时一行 86、两行 158，名称都不折行、不伸出缩略图',
    async ([viewport, width, , found, texts, height]) => {
      using ctx = await open(found, viewport);

      expect(popper().offsetWidth).toBe(width);
      expect(popper().offsetHeight).toBe(height);
      expect(thumbnailLabels().map(({ label, frame }) => labelBox(label, frame))).toStrictEqual(fitting(texts));
      expect(ctx.basemap.options).toHaveLength(texts.length);
    }
  );

  it('缩略图名称和底图卡的名称用页面的字体，不用浏览器给按钮的默认字体；选中的那张仍是半粗', async () => {
    using ctx = await open(ALL_FOUR, 1280);
    const body = getComputedStyle(document.body).fontFamily;
    const labels = thumbnailLabels().map(({ label }) => getComputedStyle(label));
    const cardLabel = getComputedStyle(required(card().lastElementChild, '底图卡的名称'));

    expect(body).toContain('Alibaba PuHuiTi');
    expect(labels.map(label => label.fontFamily)).toStrictEqual(labels.map(() => body));
    expect(cardLabel.fontFamily).toBe(body);
    expect(ctx.basemap.selected.value).toBe('standard');
    expect(labels.map(label => label.fontWeight)).toStrictEqual(['600', '400', '400', '400', '400', '400']);
  });

  it.for(
    VIEWPORTS.flatMap(([viewport]) => [
      [viewport, '极夜蓝', 'night-blue'],
      [viewport, '无底图', 'none']
    ] as const)
  )('%s 宽的视口：底图卡写"%s"也不折行', async ([viewport, text, id]) => {
    using ctx = await open(ALL_FOUR, viewport, id);

    expect(ctx.basemap.selected.value).toBe(id);
    expect([labelBox(required(card().lastElementChild, '底图卡的名称'), card())]).toStrictEqual(fitting([text]));
  });

  // 展开加 68：标注行 24 + 8 + 透明度行 24 + 间距 12；印着地名的底图（L1）和别的一样高，说明放得下
  const BAKED_HINT = { height: 16, overflow: 0 };
  it.for(
    VIEWPORTS.flatMap(([viewport]) => [
      [viewport, 'standard', 226, ALL_FOUR, BAKED_HINT],
      [viewport, 'imagery', 226, ALL_FOUR, null],
      [viewport, 'static', 226, ALL_FOUR, null],
      [viewport, 'black', 226, ALL_FOUR, BAKED_HINT],
      [viewport, 'night-blue', 226, ALL_FOUR, BAKED_HINT],
      [viewport, 'imagery', 154, servers('imagery'), null],
      [viewport, 'static', 154, servers('imagery'), null]
    ] as const)
  )('%s 宽的视口：选中 %s 展开后高 %s，地名印在底图上时说明不省略', async ([viewport, id, height, found, hint]) => {
    using ctx = await open(found, viewport, id);
    await expand();

    expect(ctx.basemap.selected.value).toBe(id);
    expect(popper().offsetHeight).toBe(height);
    expect(hintBox()).toStrictEqual(hint);
  });
});
