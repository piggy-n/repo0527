// @vitest-environment node
import type { AddProtocolAction } from 'maplibre-gl';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CompactTile, CompactTileReader } from '../tiles/arcgis-compact';
import {
  COMPACT_TILE_PROTOCOL,
  compactTileTemplate,
  type CompactTileProtocol,
  createCompactTileProtocol
} from './compact-protocol';

const ROOT = 'http://192.0.2.1:5173/basemap/imagery/';

function fakeReader(read: () => Promise<CompactTile | null>) {
  return { read: vi.fn<CompactTileReader['read']>(read) };
}

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

describe('compactTileTemplate', () => {
  it('协议名加缓存的绝对地址，末尾是 {z}/{x}/{y}', () => {
    expect(compactTileTemplate(ROOT)).toBe(`${COMPACT_TILE_PROTOCOL}://${ROOT}{z}/{x}/{y}`);
    expect(compactTileTemplate('https://example.test/')).toBe('arcgis-compact://https://example.test/{z}/{x}/{y}');
  });

  it('不是 http(s) 的绝对地址、不以 / 结尾或带查询时报错', () => {
    expect(() => compactTileTemplate('/basemap/imagery/')).toThrow(/绝对地址/);
    expect(() => compactTileTemplate('http://192.0.2.1/basemap/imagery')).toThrow(/绝对地址/);
    expect(() => compactTileTemplate('file:///basemap/')).toThrow(/绝对地址/);
    expect(() => compactTileTemplate('http://192.0.2.1/basemap/?v=1/')).toThrow(/绝对地址/);
  });
});

describe('createCompactTileProtocol', () => {
  it('结构上和 addProtocol 要的处理函数兼容', () => {
    expectTypeOf<CompactTileProtocol>().toExtend<AddProtocolAction>();
  });

  it('从模板替换出的地址还原缓存地址和瓦片号，带上瓦片的取消信号', async () => {
    const reader = fakeReader(() => Promise.resolve({ data: new ArrayBuffer(4), type: 'image/png' }));
    const protocol = createCompactTileProtocol(reader);
    const controller = new AbortController();
    await protocol({ url: tileUrl(compactTileTemplate(ROOT), 10, 849, 415) }, controller);
    expect(reader.read).toHaveBeenLastCalledWith(ROOT, 10, 849, 415, controller.signal);
    // 缓存地址自己带数字的路径段：只取最后三段作瓦片号
    const numbered = 'http://192.0.2.1/basemap/2025/18/';
    await protocol({ url: tileUrl(compactTileTemplate(numbered), 18, 215000, 103000) }, controller);
    expect(reader.read).toHaveBeenLastCalledWith(numbered, 18, 215000, 103000, controller.signal);
  });

  it('读到瓦片时只返回图片字节的 ArrayBuffer，不带缓存头', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    const protocol = createCompactTileProtocol(fakeReader(() => Promise.resolve({ data, type: 'image/jpeg' })));
    const response = await protocol({ url: tileUrl(compactTileTemplate(ROOT), 10, 849, 415) }, new AbortController());
    expect(response).toStrictEqual({ data });
    expect(response.data).toBeInstanceOf(ArrayBuffer);
  });

  it('没有这块瓦片时以 status 为 404 的 Error 结束', async () => {
    const protocol = createCompactTileProtocol(fakeReader(() => Promise.resolve(null)));
    const failure: unknown = await protocol(
      { url: tileUrl(compactTileTemplate(ROOT), 10, 849, 415) },
      new AbortController()
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ status: 404 });
  });

  it('读取失败原样报出，不当作 404', async () => {
    const error = new Error('读取失败');
    const protocol = createCompactTileProtocol(fakeReader(() => Promise.reject(error)));
    await expect(
      protocol({ url: tileUrl(compactTileTemplate(ROOT), 10, 849, 415) }, new AbortController())
    ).rejects.toBe(error);
    expect(error).not.toHaveProperty('status');
  });

  it('地址不是这个协议的瓦片地址时报错，不当作 404', async () => {
    const reader = fakeReader(() => Promise.resolve(null));
    const protocol = createCompactTileProtocol(reader);
    const urls = [`${COMPACT_TILE_PROTOCOL}://${ROOT}10/849`, `other://${ROOT}10/849/415`];
    const failures = await Promise.all(
      urls.map(url => protocol({ url }, new AbortController()).catch((error: unknown) => error))
    );
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toHaveProperty('status');
    }
    expect(reader.read).not.toHaveBeenCalled();
  });
});
