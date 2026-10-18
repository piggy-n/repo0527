import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { FeatureCollection, Polygon } from 'geojson';
import type { FillLayerSpecification, LayerSpecification, RasterSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { buildModuleUrl, Cartesian3, CesiumWidget, Color, EllipsoidTerrainProvider } from 'cesium';
import { MapSession, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { createImageryStylePort } from './imagery-style-port';
import { StyleMirror } from './style-mirror';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

const AREA: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', properties: {}, geometry: {
      type: 'Polygon', coordinates: [[[118, 31], [120, 31], [120, 33], [118, 33], [118, 31]]]
    }
  }]
};

/** 本地纯色图块，真实请求和 WebGL 混色均不依赖服务端 */
function raster(color: string, bounds?: RasterSourceSpecification['bounds']): RasterSourceSpecification {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('测试需要 Canvas 2D');
  }
  context.fillStyle = color;
  context.fillRect(0, 0, 256, 256);
  return { type: 'raster', tiles: [canvas.toDataURL()], tileSize: 256, maxzoom: 0, ...(bounds ? { bounds } : {}) };
}

function fixture(group: StyleGroup) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = 'width:512px;height:512px;';
  const widget = new CesiumWidget(container, {
    baseLayer: false, terrainProvider: new EllipsoidTerrainProvider(),
    skyBox: false, skyAtmosphere: false, scene3DOnly: true,
    requestRenderMode: true, maximumRenderTimeChange: Infinity, showRenderLoopErrors: false
  });
  widget.scene.globe.baseColor = Color.BLACK;
  widget.scene.globe.showGroundAtmosphere = false;
  widget.scene.fog.enabled = false;
  widget.scene.camera.setView({ destination: Cartesian3.fromDegrees(119, 32, 600000) });
  const session = new MapSession({ groups: ['sample'], camera: { center: [119, 32], zoom: 8, bearing: 0, pitch: 0 } });
  session.style.setGroup('sample', group);
  const errors: unknown[] = [];
  const unsubscribe = widget.scene.renderError.addEventListener((_scene, error: unknown) => errors.push(error));
  const mirror = new StyleMirror({
    style: session.style, camera: session.camera,
    port: createImageryStylePort({ layers: widget.imageryLayers, requestRender: () => widget.scene.requestRender() }),
    onError: error => errors.push(error)
  });
  return {
    container, widget, session, mirror, errors,
    [Symbol.dispose]: () => {
      mirror[Symbol.dispose]();
      session[Symbol.dispose]();
      unsubscribe();
      widget.destroy();
      container.remove();
    }
  };
}

/** 渲染回调内采样，避免默认 WebGL 缓冲在回调外已清空；超时也返回最后的像素供断言 */
async function pixelAfter(widget: CesiumWidget, expected: readonly number[], action: () => void = () => {}) {
  const snapshot = document.createElement('canvas');
  snapshot.width = 1;
  snapshot.height = 1;
  const context = snapshot.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('测试需要 Canvas 2D');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remove: (() => void) | undefined;
  let last: number[] = [];
  try {
    return await new Promise<{ matches: boolean; pixel: number[] }>(resolve => {
      remove = widget.scene.postRender.addEventListener(() => {
        if (!widget.scene.globe.tilesLoaded) {
          return;
        }
        const canvas = widget.canvas;
        context.clearRect(0, 0, 1, 1);
        context.drawImage(canvas, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, 0, 0, 1, 1);
        last = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        if (last.every((channel, index) => Math.abs(channel - expected[index]) <= 3)) {
          resolve({ matches: true, pixel: last });
        }
      });
      timer = setTimeout(() => resolve({ matches: false, pixel: last }), 8000);
      action();
      widget.scene.requestRender();
    });
  } finally {
    clearTimeout(timer);
    remove?.();
  }
}

describe('三维影像样式真实画面', () => {
  it('栅格与面按会话交错排序，变色、透明、显隐、换源和暂停恢复都改变实际像素', async () => {
    const sources = { bottom: raster('#ff0000'), top: raster('#0000ff'), area: { type: 'geojson' as const, data: AREA } };
    const bottom: LayerSpecification = { id: 'bottom', type: 'raster', source: 'bottom' };
    const top: LayerSpecification = { id: 'top', type: 'raster', source: 'top', paint: { 'raster-opacity': 0.5 } };
    const fill: FillLayerSpecification = { id: 'area', type: 'fill', source: 'area', paint: { 'fill-color': '#00ff00' } };
    using ctx = fixture({ sources, layers: [bottom, fill, top] });
    const anchor = ctx.widget.imageryLayers.get(0).imageryProvider;
    expect(await anchor.requestImage(0, 0, 0)?.then(() => true, () => false)).toBe(true);
    expect(await pixelAfter(ctx.widget, [0, 128, 128])).toMatchObject({ matches: true });
    expect(await pixelAfter(ctx.widget, [0, 255, 0], () => {
      ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, fill] });
    })).toMatchObject({ matches: true });

    const yellow: FillLayerSpecification = { ...fill, paint: { 'fill-color': '#ffff00' } };
    expect(await pixelAfter(ctx.widget, [255, 255, 0], () => {
      ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, yellow] });
    })).toMatchObject({ matches: true });
    const hidden: FillLayerSpecification = { ...yellow, layout: { visibility: 'none' } };
    expect(await pixelAfter(ctx.widget, [128, 0, 128], () => {
      ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, hidden] });
    })).toMatchObject({ matches: true });

    const changed = { ...sources, top: raster('#ffffff') };
    expect(await pixelAfter(ctx.widget, [255, 128, 128], () => {
      ctx.session.style.setGroup('sample', { sources: changed, layers: [bottom, top, hidden] });
    })).toMatchObject({ matches: true });
    ctx.mirror.pause();
    const purple: FillLayerSpecification = { ...fill, paint: { 'fill-color': '#8000ff' } };
    ctx.session.style.setGroup('sample', { sources: changed, layers: [bottom, top, yellow] });
    ctx.session.style.setGroup('sample', { sources: changed, layers: [bottom, top, purple] });
    expect(await pixelAfter(ctx.widget, [255, 128, 128])).toMatchObject({ matches: true });
    expect(await pixelAfter(ctx.widget, [128, 0, 255], () => ctx.mirror.resume())).toMatchObject({ matches: true });

    expect(await pixelAfter(ctx.widget, [0, 255, 255], () => {
      ctx.session.style.setGroup('sample', {
        sources: changed,
        layers: [bottom, top, purple, { id: 'background', type: 'background', paint: { 'background-color': '#00ffff' } }]
      });
    })).toMatchObject({ matches: true });
    ctx.mirror[Symbol.dispose]();
    expect(ctx.widget.imageryLayers.length).toBe(0);
    expect(ctx.errors).toEqual([]);
  }, 60000);

  it('局部栅格在覆盖范围之外不被作为首层拉伸', async () => {
    using ctx = fixture({
      sources: { local: raster('#ff0000', [118, 31, 119.2, 33]) },
      layers: [{ id: 'local', type: 'raster', source: 'local' }]
    });
    expect(await pixelAfter(ctx.widget, [255, 0, 0])).toMatchObject({ matches: true });
    expect(await pixelAfter(ctx.widget, [0, 0, 0], () => {
      ctx.widget.scene.camera.setView({ destination: Cartesian3.fromDegrees(120, 32, 600000) });
    })).toMatchObject({ matches: true });
    expect(ctx.errors).toEqual([]);
  }, 20000);
});
