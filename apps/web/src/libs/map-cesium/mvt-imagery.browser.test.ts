import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { FillLayerSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  buildModuleUrl, Cartesian3, CesiumWidget, Color, EllipsoidTerrainProvider, WebMercatorProjection, WebMercatorTilingScheme
} from 'cesium';
import { MapSession, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { createMvtFixture } from './mvt-fixture';
import { createImageryStylePort } from './imagery-style-port';
import { StyleMirror } from './style-mirror';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

// 本地纯色栅格与合成 MVT 一同经过真实 SDK 的纹理上传和混色
function raster(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) { throw new Error('测试需要 Canvas 2D'); }
  context.fillStyle = color;
  context.fillRect(0, 0, 256, 256);
  return { type: 'raster' as const, tiles: [canvas.toDataURL()], tileSize: 256, maxzoom: 0 };
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
  widget.scene.camera.setView({ destination: Cartesian3.fromDegrees(-100, 40, 600000) });
  const session = new MapSession({ groups: ['sample'], camera: { center: [-100, 40], zoom: 8, bearing: 0, pitch: 0 } });
  session.style.setGroup('sample', group);
  const errors: unknown[] = [];
  const removeError = widget.scene.renderError.addEventListener((_scene, error: unknown) => errors.push(error));
  let createdWorkers = 0;
  let terminatedWorkers = 0;
  const port = createImageryStylePort({
    layers: widget.imageryLayers, requestRender: () => widget.scene.requestRender(),
    mvt: {
      workerCount: 1,
      createWorker: () => {
        const worker = new Worker(new URL('./mvt.worker.ts', import.meta.url), { type: 'module' });
        createdWorkers++;
        return {
          postMessage: worker.postMessage.bind(worker),
          addEventListener: worker.addEventListener.bind(worker),
          removeEventListener: worker.removeEventListener.bind(worker),
          terminate: () => { terminatedWorkers++; worker.terminate(); }
        };
      }
    }
  });
  const mirror = new StyleMirror({ style: session.style, camera: session.camera, port, onError: error => errors.push(error) });
  return {
    widget, session, mirror, port, errors,
    workers: () => ({ created: createdWorkers, terminated: terminatedWorkers }),
    [Symbol.dispose]: () => {
      mirror[Symbol.dispose]();
      port[Symbol.dispose]();
      session[Symbol.dispose]();
      removeError();
      widget.destroy();
      container.remove();
    }
  };
}

// 只在真实帧完成且影像就绪后读取像素；等待在操作之前注册，结束后释放事件与定时器
async function pixelAfter(widget: CesiumWidget, expected: readonly number[], action: () => void = () => {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { throw new Error('测试需要 Canvas 2D'); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remove: (() => void) | undefined;
  let last: number[] = [];
  try {
    return await new Promise<{ readonly matches: boolean; readonly pixel: readonly number[] }>(resolve => {
      remove = widget.scene.postRender.addEventListener(() => {
        if (!widget.scene.globe.tilesLoaded) { return; }
        const output = widget.canvas;
        context.clearRect(0, 0, 1, 1);
        context.drawImage(output, Math.floor(output.width / 2), Math.floor(output.height / 2), 1, 1, 0, 0, 1, 1);
        last = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        if (last.every((channel, index) => Math.abs(channel - expected[index]) <= 3)) {
          resolve({ matches: true, pixel: last });
        }
      });
      timer = setTimeout(() => resolve({ matches: false, pixel: last }), 15000);
      action();
      widget.scene.requestRender();
    });
  } finally {
    clearTimeout(timer);
    remove?.();
  }
}

describe('MVT 与基础样式的真实三维画面', () => {
  it('没有 bounds 的高最小级别来源能越过透明祖先，首轮实际画面正常就绪', async () => {
    const url = URL.createObjectURL(new Blob([createMvtFixture()], { type: 'application/vnd.mapbox-vector-tile' }));
    try {
      using ctx = fixture({
        sources: { mvt: { type: 'vector', tiles: [url], minzoom: 8, maxzoom: 8, promoteId: 'bsm' } },
        layers: [{
          id: 'mvt', type: 'fill', source: 'mvt', 'source-layer': 'landuse', minzoom: 8,
          filter: ['==', ['id'], 'area-primary'], paint: { 'fill-color': '#00ff00' }
        }]
      });
      // 把视角放在原生瓦片的实色区域，真实 SDK 自行请求影像祖先与当前显示子瓦片
      const bounds = new WebMercatorTilingScheme().tileXYToNativeRectangle(56, 97, 8);
      const center = new WebMercatorProjection().unproject(new Cartesian3(
        bounds.west + (bounds.east - bounds.west) / 8,
        bounds.north - (bounds.north - bounds.south) / 8
      ));
      ctx.widget.scene.camera.setView({ destination: Cartesian3.fromRadians(center.longitude, center.latitude, 60000) });
      expect(await pixelAfter(ctx.widget, [0, 255, 0])).toMatchObject({ matches: true });
      expect(ctx.widget.scene.globe.tilesLoaded).toBe(true);
      expect(ctx.workers()).toEqual({ created: 1, terminated: 0 });
      expect(ctx.errors).toEqual([]);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 25000);

  it('MVT、栅格和 GeoJSON 按会话混排，重排、换色、显隐和暂停恢复后仍保持层序', async () => {
    const url = URL.createObjectURL(new Blob([createMvtFixture()], { type: 'application/vnd.mapbox-vector-tile' }));
    try {
      const sources: StyleGroup['sources'] = {
        bottom: raster('#ff0000'), top: raster('#0000ff'),
        mvt: { type: 'vector', tiles: [url], maxzoom: 0, promoteId: 'bsm' },
        area: { type: 'geojson', data: {
          type: 'Polygon', coordinates: [[[-102, 38], [-98, 38], [-98, 42], [-102, 42], [-102, 38]]]
        } }
      };
      const bottom: LayerSpecification = { id: 'bottom', type: 'raster', source: 'bottom' };
      const top: LayerSpecification = { id: 'top', type: 'raster', source: 'top', paint: { 'raster-opacity': 0.5 } };
      const geo: FillLayerSpecification = {
        id: 'geo', type: 'fill', source: 'area', paint: { 'fill-color': '#ffff00', 'fill-opacity': 0.5 }
      };
      const mvt: FillLayerSpecification = {
        id: 'mvt', type: 'fill', source: 'mvt', 'source-layer': 'landuse',
        filter: ['==', ['id'], 'area-primary'], paint: { 'fill-color': '#00ff00' }
      };
      using ctx = fixture({ sources, layers: [bottom, mvt, top, geo] });
      expect(await pixelAfter(ctx.widget, [128, 192, 64])).toMatchObject({ matches: true });
      expect(await pixelAfter(ctx.widget, [0, 255, 0], () => {
        ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, geo, mvt] });
      })).toMatchObject({ matches: true });
      const previousProvider = ctx.widget.imageryLayers.get(ctx.widget.imageryLayers.length - 1).imageryProvider;
      ctx.port.pause();
      expect(await pixelAfter(ctx.widget, [0, 255, 0], () => ctx.port.resume())).toMatchObject({ matches: true });
      expect(ctx.widget.imageryLayers.get(ctx.widget.imageryLayers.length - 1).imageryProvider).not.toBe(previousProvider);
      const purple: FillLayerSpecification = { ...mvt, paint: { 'fill-color': '#8000ff' } };
      expect(await pixelAfter(ctx.widget, [128, 0, 255], () => {
        ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, geo, purple] });
      })).toMatchObject({ matches: true });
      const hidden: FillLayerSpecification = { ...purple, layout: { visibility: 'none' } };
      expect(await pixelAfter(ctx.widget, [192, 128, 64], () => {
        ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, geo, hidden] });
      })).toMatchObject({ matches: true });
      ctx.port.pause();
      ctx.mirror.pause();
      const cyan: FillLayerSpecification = { ...mvt, paint: { 'fill-color': '#00ffff' } };
      ctx.session.style.setGroup('sample', { sources, layers: [bottom, top, geo, cyan] });
      expect(await pixelAfter(ctx.widget, [192, 128, 64])).toMatchObject({ matches: true });
      expect(await pixelAfter(ctx.widget, [0, 255, 255], () => {
        ctx.port.resume();
        ctx.mirror.resume();
      })).toMatchObject({ matches: true });
      expect(ctx.workers()).toEqual({ created: 1, terminated: 0 });
      ctx.mirror[Symbol.dispose]();
      ctx.port[Symbol.dispose]();
      expect(ctx.widget.imageryLayers.length).toBe(0);
      expect(ctx.workers()).toEqual({ created: 1, terminated: 1 });
      expect(ctx.errors).toEqual([]);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 60000);
});
