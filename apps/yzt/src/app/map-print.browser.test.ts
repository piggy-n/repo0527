import type { GeoJSONSourceSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { type CameraState, MapLibreView, MapSession, type StyleGroup } from '@mx/map-core';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/features/resource-map/catalog';
import { LANDUSE_GROUPS } from '@/features/resource-map/landuse';
import { printEntries, renderedClasses, resourcePrintBlocks } from '@/features/resource-map/print-legend';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  resourcesGroup
} from '@/features/resource-map/resource-layers';
import { boundaryPrintBlock } from '@/shared/map/boundary/boundary-print';
import { composePrintImage } from '@/shared/map/print/print-image';
import type { PrintLegendBlock } from '@/shared/map/print/print-legend';

// 地图打印（ADR 0174）放在真实的 MapLibre 上：截图、整屏查画出来的取值、合成带图例的图片。
// 数据换成内联 GeoJSON；测试页面没有普惠体，文字按后备字体画，这里只看排法和颜色

const WAIT_TIMEOUT = 10_000;
const DLTB = 'bgdc_dltb';
const CENTER: [number, number] = [118.8, 32];
const CAMERA: CameraState = { center: CENTER, zoom: 14, bearing: 0, pitch: 0 };

const guidOf = (index: number) => index.toString(16).padStart(32, '0');

function parcel(index: number, dlbm: string, west: number, south: number, size: number): Feature {
  const ring = [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south]
  ];
  return {
    type: 'Feature',
    properties: { guid: guidOf(index), dlbm },
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}

// 画面里是左右两块：水田、河流水面；乔木林地在画面外很远的地方
const PARCELS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    parcel(1, '0101', CENTER[0] - 0.02, CENTER[1] - 0.02, 0.02),
    parcel(2, '1101', CENTER[0], CENTER[1] - 0.02, 0.02),
    parcel(3, '0301', CENTER[0] + 1, CENTER[1] + 1, 0.02)
  ]
};

const CATALOG = buildCatalog([
  { code: null, name: '测试', children: [{ code: DLTB, name: '地类图斑', geoType: 'Polygon', yearList: [2022] }] }
]);

function displayed(): ResourceLayersState {
  const merged = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);
  const displays = new Map(
    [...merged.displays].map(([code, display]) => [code, { ...display, added: true, checked: true }])
  );
  return { ...merged, displays };
}

const STATE = displayed();

// GeoJSON 数据源的图层不能有瓦片图层名
function inline(group: StyleGroup): StyleGroup {
  const sources = Object.fromEntries(
    Object.keys(group.sources).map((id): [string, GeoJSONSourceSpecification] => [
      id,
      { type: 'geojson', data: PARCELS }
    ])
  );
  const layers = group.layers.map(
    layer => Object.fromEntries(Object.entries(layer).filter(([key]) => key !== 'source-layer')) as LayerSpecification
  );
  return { ...group, sources, layers };
}

const BACKGROUND: StyleGroup = {
  sources: {},
  layers: [{ id: 'basemap-background', type: 'background', paint: { 'background-color': '#f3efe6' } }]
};

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setup() {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const session = new MapSession({ groups: ['basemap', 'resources'], camera: CAMERA });
  session.style.setGroups({
    basemap: BACKGROUND,
    resources: inline(resourcesGroup({ state: STATE, invalid: new Map(), tileBase: 'http://localhost/' }))
  });
  const view = new MapLibreView({ session, container, createMap: options => new MapLibreMap(options) });
  return {
    view,
    [Symbol.dispose]() {
      view[Symbol.dispose]();
      session[Symbol.dispose]();
      container.remove();
    }
  };
}

// 地类在图例里的颜色（rgb 三个数）
function landuseRgb(code: string): readonly number[] {
  const color = LANDUSE_GROUPS.flatMap(group => group.classes).find(item => item.code === code)?.color ?? '';
  return (color.match(/\d+/g) ?? []).map(Number);
}

// 图片某个区域里某种颜色的像素有多少（每个通道差 3 以内）
function countColor(image: HTMLCanvasElement, rgb: readonly number[], x: number, width: number): number {
  const data = image.getContext('2d')?.getImageData(x, 0, width, image.height).data ?? new Uint8ClampedArray();
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (rgb.every((value, channel) => Math.abs((data[index + channel] ?? 0) - value) <= 3)) {
      count += 1;
    }
  }
  return count;
}

describe('地图打印（真实的 MapLibre，ADR 0174）', () => {
  it('截图和图例合成一张图：图例只列画面里画出来的取值，右侧一栏在地图右边', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '视图就绪');
    await withTimeout(ctx.view.whenComplete(), '画面完整');

    const snapshot = ctx.view.snapshot();
    const input = { state: STATE, invalid: new Map(), overrideOf: () => undefined, zoom: CAMERA.zoom };
    const rendered = renderedClasses({ ...input, view: ctx.view, size: snapshot, scope: null });
    expect(rendered.get(DLTB)).toStrictEqual(new Set(['0101', '1101']));

    const province = boundaryPrintBlock({ visible: { province: true, city: false, county: false }, opacity: 1 });
    const blocks = [...resourcePrintBlocks(printEntries(input, rendered)), province].filter(
      (block): block is PrintLegendBlock => block !== null
    );
    const { canvas, placement } = composePrintImage(snapshot, blocks, 'side');

    const ratio = snapshot.image.width / snapshot.width;
    const mapWidth = snapshot.image.width;
    expect(placement).toBe('side');
    expect([canvas.width, canvas.height]).toStrictEqual([Math.round((800 + 232) * ratio), Math.round(600 * ratio)]);
    // 地图原样在左边：两块地类各占一大片；图例里各有一个符号，画面外的乔木林地两边都没有
    for (const code of ['0101', '1101']) {
      expect(countColor(canvas, landuseRgb(code), 0, mapWidth)).toBeGreaterThan(10_000 * ratio * ratio);
      const inLegend = countColor(canvas, landuseRgb(code), mapWidth, canvas.width - mapWidth);
      expect(inLegend).toBeGreaterThan(50 * ratio * ratio);
    }
    expect(countColor(canvas, landuseRgb('0301'), 0, canvas.width)).toBe(0);
  });

  it('右下角的图例叠在地图上，图片和地图一样大', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '视图就绪');
    await withTimeout(ctx.view.whenComplete(), '画面完整');

    const snapshot = ctx.view.snapshot();
    const input = { state: STATE, invalid: new Map(), overrideOf: () => undefined, zoom: CAMERA.zoom };
    const rendered = renderedClasses({ ...input, view: ctx.view, size: snapshot, scope: null });
    const blocks = resourcePrintBlocks(printEntries(input, rendered));
    const { canvas, placement } = composePrintImage(snapshot, blocks, 'corner');

    expect(placement).toBe('corner');
    expect([canvas.width, canvas.height]).toStrictEqual([snapshot.image.width, snapshot.image.height]);
    // 右下角是图例半透明的白底，盖住了下面的地类
    const ratio = snapshot.image.width / snapshot.width;
    const context = canvas.getContext('2d');
    const corner = context?.getImageData(canvas.width - 40 * ratio, canvas.height - 30 * ratio, 1, 1).data;
    expect([...(corner ?? [])].slice(0, 3).every(value => value > 240)).toBe(true);
  });
});
