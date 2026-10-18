// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { decodeMvt } from './mvt-decode';
import { gate, sampleTile, tileBytes } from './testing';

const SIGNAL = new AbortController().signal;

describe('MVT 解码', () => {
  it('读取真实 PBF 的层、extent、ID 和几何，按登记字段裁剪属性', async () => {
    const raw = sampleTile();
    const result = await decodeMvt(raw, new Set(['class', 'enabled']), { signal: SIGNAL });
    expect(result.layers['地块'].extent).toBe(4096);
    expect(result.layers['地块'].features).toHaveLength(1);
    const feature = result.layers['地块'].features[0];
    expect(feature.id).toBe(7);
    expect(feature.type).toBe(1);
    expect(feature.properties).toEqual({ class: '林地', enabled: true });
    expect(feature.geometry).toEqual([new Int32Array([1024, 2048])]);
    expect(result.bytes).toBeGreaterThan(feature.geometry[0].byteLength);
    expect((await decodeMvt(raw, null, { signal: SIGNAL })).layers['地块'].features[0].properties)
      .toEqual({ class: '林地', name: '样本', enabled: true });
  });

  it('点、线、面采用各自路径，面洞和第二个面由成熟库分类且不复制几何', async () => {
    const result = await decodeMvt(tileBytes([{
      name: 'mixed', extent: 8192,
      features: [
        { type: 1, paths: [[[1, 2], [3, 4]]] },
        { type: 2, paths: [[[-16, 0], [8208, 8192]], [[100, 200], [300, 400]]] },
        { type: 3, paths: [
          [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
          [[20, 20], [20, 40], [40, 40], [40, 20], [20, 20]],
          [[200, 200], [300, 200], [300, 300], [200, 300], [200, 200]]
        ] }
      ]
    }]), null, { signal: SIGNAL });
    const layer = result.layers['mixed'];
    expect(layer.extent).toBe(8192);
    expect(layer.features[0].geometry).toEqual([new Int32Array([1, 2]), new Int32Array([3, 4])]);
    expect(layer.features[1].geometry[0]).toEqual(new Int32Array([-16, 0, 8208, 8192]));
    const polygon = layer.features[2];
    expect(polygon.polygons?.map(rings => rings.length)).toEqual([2, 1]);
    expect(polygon.polygons?.[0][0]).toBe(polygon.geometry[0]);
    expect(polygon.polygons?.[0][1]).toBe(polygon.geometry[1]);
    expect(polygon.polygons?.[1][0]).toBe(polygon.geometry[2]);
  });

  it('空响应是合法空瓦片，损坏 PBF、无效 extent 和未知几何明确失败', async () => {
    expect(await decodeMvt(new ArrayBuffer(0), null, { signal: SIGNAL })).toEqual({ layers: {}, bytes: 64 });
    await expect(decodeMvt(new Uint8Array([15]).buffer, null, { signal: SIGNAL })).rejects.toThrow(/type/);
    await expect(decodeMvt(tileBytes([{ name: 'bad', extent: 0, features: [
      { type: 1, paths: [[[0, 0]]] }
    ] }]), null, { signal: SIGNAL })).rejects.toThrow('extent');
    await expect(decodeMvt(tileBytes([{ name: 'bad', features: [
      { type: 0, paths: [[[0, 0]]] }
    ] }]), null, { signal: SIGNAL })).rejects.toThrow('几何类型');
  });

  it('拒绝越界坐标与不安全 ID，不让 TypedArray 截断数据', async () => {
    await expect(decodeMvt(tileBytes([{ name: 'bad', features: [
      { type: 1, paths: [[[2147483648, 0]]] }
    ] }]), null, { signal: SIGNAL })).rejects.toThrow('Int32');
    await expect(decodeMvt(tileBytes([{ name: 'bad', features: [
      { id: 2 ** 53, type: 1, paths: [[[0, 0]]] }
    ] }]), null, { signal: SIGNAL })).rejects.toThrow('ID');
  });

  it('属性量计入预算，裁剪后的缓存小于完整属性缓存', async () => {
    const raw = tileBytes([{ name: 'large', features: [
      { type: 1, properties: { keep: 'a', unused: '大字段'.repeat(1000) }, paths: [[[0, 0]]] }
    ] }]);
    const small = await decodeMvt(raw, new Set(['keep']), { signal: SIGNAL });
    const full = await decodeMvt(raw, null, { signal: SIGNAL });
    expect(full.bytes - small.bytes).toBeGreaterThan(6000);
  });

  it('分批让出事件循环，并在等待返回后确认取消', async () => {
    const raw = tileBytes([{ name: 'many', features: Array.from({ length: 130 }, () => ({
      type: 1, paths: [[[0, 0]]] as const
    })) }]);
    const checkpoint = vi.fn<() => Promise<void>>(async () => {});
    await decodeMvt(raw, null, { signal: SIGNAL, checkpoint });
    expect(checkpoint).toHaveBeenCalledTimes(3);
    const boundary = gate<void>();
    const controller = new AbortController();
    const waiting = decodeMvt(raw, null, { signal: controller.signal, checkpoint: () => boundary.promise });
    controller.abort();
    boundary.resolve();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await expect(decodeMvt(raw, null, { signal: controller.signal, checkpoint }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(checkpoint).toHaveBeenCalledTimes(3);
  });
});
