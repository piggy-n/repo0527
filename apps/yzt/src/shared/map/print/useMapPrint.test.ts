import type { MapSnapshot, SnapshotOptions, ViewKind } from '@mx/map-core';
import type { MapContext, MapViewport } from '@mx/map-vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import type { PrintLegendBlock } from './print-legend';
import { type MapPrintOptions, useMapPrint } from './useMapPrint';

// jsdom 没有 Canvas 2D：合成用的上下文换成什么也不画的假对象，量文字按字数；编码直接给出一个 PNG
function stubCanvas(): void {
  const context = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 12 }) },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
      set: () => true
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback =>
    callback(new Blob(['png'], { type: 'image/png' }))
  );
}

beforeEach(stubCanvas);
afterEach(() => vi.restoreAllMocks());

// 截图的假视图：记下选项，图片的像素按像素比放大
function fakeViewport(kind: ViewKind = '2d') {
  const snapshots: (SnapshotOptions | undefined)[] = [];
  const viewport = {
    kind,
    snapshot: (options?: SnapshotOptions): MapSnapshot => {
      snapshots.push(options);
      const image = document.createElement('canvas');
      const ratio = options?.pixelRatio ?? 1;
      image.width = 1440 * ratio;
      image.height = 800 * ratio;
      return { image, width: 1440, height: 800 };
    }
  };
  return { viewport: viewport as unknown as MapViewport, snapshots };
}

// 地图上下文：whenComplete 的每次调用由用例结束
function fakeMap(viewport: MapViewport | null) {
  const completions: {
    readonly signal: AbortSignal | undefined;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  }[] =
    [];
  const map = {
    view: shallowRef(viewport),
    whenComplete: (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        completions.push({ signal, resolve, reject });
        signal?.addEventListener('abort', () => reject(new DOMException('等待已取消', 'AbortError')));
      })
  };
  return { map: map as unknown as MapContext, completions };
}

const BLOCKS: PrintLegendBlock[] = [{ title: null, rows: [{ label: '学校点层（2025）', drawSwatch: () => undefined }] }];

function setup(viewport: MapViewport | null) {
  const { map, completions } = fakeMap(viewport);
  const legend = vi.fn<MapPrintOptions['legend']>(() => BLOCKS);
  const scope = effectScope();
  const print = scope.run(() =>
    useMapPrint(map, { name: '现状底图', omitGroups: ['measure', 'selection'], legend })
  );
  if (!print) {
    throw new Error('没有创建打印');
  }
  return { print, completions, legend, scope };
}

// 让排在前面的微任务、Promise 回调都跑完
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useMapPrint', () => {
  it('先等画面完整，再截图（不画测量和选中高亮）、按截下的尺寸推导图例、合成编码；二维按 2 倍截', async () => {
    const { viewport, snapshots } = fakeViewport();
    const { print, completions, legend } = setup(viewport);

    const running = print.run({ legend: 'side', double: true });
    await settle();
    expect(print.phase.value).toBe('waiting');
    expect(snapshots).toStrictEqual([]);

    completions[0]?.resolve();
    const result = await running;

    expect(snapshots).toStrictEqual([{ omitGroups: ['measure', 'selection'], pixelRatio: 2 }]);
    expect(legend).toHaveBeenCalledWith(viewport, expect.objectContaining({ width: 1440, height: 800 }));
    expect(result?.fileName).toMatch(/^现状底图-\d{8}-\d{6}\.png$/);
    expect(result?.blob.type).toBe('image/png');
    expect(result?.placement).toBe('side');
    // 地图 1440 加右侧一栏 232，按 2 倍的像素
    expect([result?.width, result?.height]).toStrictEqual([3344, 1600]);
    expect(print.phase.value).toBe('idle');
    expect(print.error.value).toBe('');
  });

  it('三维照屏幕的像素比；没有图例条目时只有地图', async () => {
    const { viewport, snapshots } = fakeViewport('3d');
    const { print, completions, legend } = setup(viewport);
    legend.mockReturnValue([]);

    const running = print.run({ legend: 'corner', double: true });
    await settle();
    completions[0]?.resolve();

    expect((await running)?.placement).toBe('none');
    expect(snapshots).toStrictEqual([{ omitGroups: ['measure', 'selection'] }]);
  });

  it('"不等了"时按当前画面导出', async () => {
    const { viewport, snapshots } = fakeViewport();
    const { print, completions } = setup(viewport);

    const running = print.run({ legend: 'side', double: false });
    await settle();
    print.skipWait();

    expect(await running).not.toBeNull();
    expect(completions[0]?.signal?.aborted).toBe(true);
    expect(snapshots).toHaveLength(1);
  });

  it('取消时放弃，不截图、不记失败；同一时间只有一次导出', async () => {
    const { viewport, snapshots } = fakeViewport();
    const { print } = setup(viewport);

    const running = print.run({ legend: 'side', double: false });
    expect(await print.run({ legend: 'side', double: false })).toBeNull();
    await settle();
    print.cancel();

    expect(await running).toBeNull();
    expect(snapshots).toStrictEqual([]);
    expect(print.error.value).toBe('');
    expect(print.phase.value).toBe('idle');
  });

  it('等的时候视图卸下、换了二三维：记下失败，提示重新导出', async () => {
    const { viewport } = fakeViewport();
    const { print, completions } = setup(viewport);

    const running = print.run({ legend: 'side', double: false });
    await settle();
    completions[0]?.reject(new DOMException('等待的视图已被卸下或替换', 'AbortError'));

    expect(await running).toBeNull();
    expect(print.error.value).toBe('地图在等待时发生了变化，请重新导出');
  });

  it('截图出错、没有就绪的视图时记下原因；下一次开始时清空', async () => {
    const { print, completions } = setup(null);

    const missing = print.run({ legend: 'side', double: false });
    await settle();
    completions[0]?.resolve();
    expect(await missing).toBeNull();
    expect(print.error.value).toBe('地图还没有就绪，请稍后再导出');

    const next = print.run({ legend: 'side', double: false });
    expect(print.error.value).toBe('');
    print.cancel();
    await next;
  });

  it('作用域销毁时作废正在进行的导出，之后不再导出', async () => {
    const { viewport, snapshots } = fakeViewport();
    const { print, scope } = setup(viewport);

    const running = print.run({ legend: 'side', double: false });
    await settle();
    scope.stop();

    expect(await running).toBeNull();
    expect(await print.run({ legend: 'side', double: false })).toBeNull();
    expect(snapshots).toStrictEqual([]);
    expect(print.error.value).toBe('');
  });

  it('不带图例时不推导图例（不整屏查要素）', async () => {
    const { viewport } = fakeViewport();
    const { print, completions, legend } = setup(viewport);

    const running = print.run({ legend: 'none', double: false });
    await settle();
    completions[0]?.resolve();

    expect((await running)?.placement).toBe('none');
    expect(legend).not.toHaveBeenCalled();
  });

  it('预览的截图：先等画面完整，再按屏幕的像素比截一帧；带图例时紧接着推导图例，不带时不查', async () => {
    const { viewport, snapshots } = fakeViewport();
    const { print, completions, legend } = setup(viewport);
    const { signal } = new AbortController();

    const capturing = print.capture(true, signal);
    await settle();
    expect(snapshots).toStrictEqual([]);
    expect(completions[0]?.signal).toBe(signal);
    completions[0]?.resolve();
    expect((await capturing)?.blocks).toStrictEqual(BLOCKS);
    expect(snapshots).toStrictEqual([{ omitGroups: ['measure', 'selection'] }]);

    const plain = print.capture(false, signal);
    await settle();
    completions[1]?.resolve();
    expect((await plain)?.blocks).toStrictEqual([]);
    expect(legend).toHaveBeenCalledTimes(1);
  });

  it('预览的截图等完时正在导出就不截；没有就绪的视图时为 null', async () => {
    const { viewport, snapshots } = fakeViewport();
    const { print, completions } = setup(viewport);

    const capturing = print.capture(true, new AbortController().signal);
    const running = print.run({ legend: 'side', double: false });
    await settle();
    completions[0]?.resolve();
    await expect(capturing).rejects.toMatchObject({ name: 'AbortError' });
    expect(snapshots).toStrictEqual([]);
    print.cancel();
    await running;

    const missing = setup(null);
    const empty = missing.print.capture(true, new AbortController().signal);
    await settle();
    missing.completions[0]?.resolve();
    expect(await empty).toBeNull();
  });
});
