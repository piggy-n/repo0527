// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CameraState } from '../camera/camera-model';
import { NO_SCENE_STATUS, type SceneStatus, type SplatLayer, type TilesetStatus } from './scene-content-model';
import { mergeSceneStatus, SceneSplatSync, type SplatHost, type SplatOptions, type SplatSource } from './splat-sync';

const CAMERA: CameraState = { center: [117.06, 34.27], zoom: 17, bearing: 0, pitch: 55 };

// 引擎一侧：每次加入挂起，测试决定成功还是失败；ignoresAbort 时不理中止，照样等测试交回结果（晚到的结果）
class FakeHost implements SplatHost {
  readonly calls: string[] = [];
  readonly pending = new Map<string, { resolve: (camera: CameraState) => void; reject: (error: unknown) => void }>();
  ignoresAbort = false;

  addSplat(id: string, source: SplatSource, options: SplatOptions, signal: AbortSignal): Promise<CameraState> {
    this.calls.push(`add ${id} ${source.placement.height} ${options.show ? 'show' : 'hide'}`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (!this.ignoresAbort) {
        signal.addEventListener('abort', () => reject(new DOMException('加载已中止', 'AbortError')));
      }
    });
  }

  updateSplat(id: string, options: SplatOptions): void {
    this.calls.push(`update ${id} ${options.show ? 'show' : 'hide'}`);
  }

  removeSplat(id: string): void {
    this.calls.push(`remove ${id}`);
  }
}

const layer = (id: string, extra: Partial<SplatLayer> = {}): SplatLayer => ({
  id,
  url: `https://models.test/${id}/${id}.lcc2`,
  show: true,
  placement: { lng: 117.06, lat: 34.27, height: 59.7, heading: 0 },
  attempt: 0,
  ...extra
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  const host = new FakeHost();
  const statuses: SceneStatus[] = [];
  const sync = new SceneSplatSync({ host, onStatus: status => statuses.push(status) });
  const states = () => Object.fromEntries([...sync.status].map(([id, status]) => [id, status.state]));
  return { host, sync, statuses, states };
}

describe('SceneSplatSync', () => {
  it('新的泼溅先报告加载中，引擎加好后就绪并带上建议的相机；删掉时从引擎移除、状态里不再有它', async () => {
    const { host, sync, statuses, states } = setup();

    sync.apply([layer('cws')]);
    expect(states()).toStrictEqual({ cws: 'loading' });
    expect(host.calls).toStrictEqual(['add cws 59.7 show']);
    host.pending.get('cws')?.resolve(CAMERA);
    await flush();
    expect(sync.status.get('cws')).toStrictEqual({ state: 'ready', camera: CAMERA });

    sync.apply([]);
    expect(host.calls.at(-1)).toBe('remove cws');
    expect(states()).toStrictEqual({});
    expect(new Set(statuses).size).toBe(statuses.length);
  });

  it('只改显示时不重新加载；加载中改过的显示在加好以后补上', async () => {
    const { host, sync } = setup();

    sync.apply([layer('cws')]);
    sync.apply([layer('cws', { show: false })]);
    host.pending.get('cws')?.resolve(CAMERA);
    await flush();
    expect(host.calls).toStrictEqual(['add cws 59.7 show', 'update cws hide']);

    sync.apply([layer('cws', { show: true })]);
    sync.apply([layer('cws', { show: true })]);
    expect(host.calls).toStrictEqual(['add cws 59.7 show', 'update cws hide', 'update cws show']);
  });

  it('地址、摆放、重试次数变了就移除重新加载；还没加进引擎的不用移除', async () => {
    const { host, sync, states } = setup();

    sync.apply([layer('cws')]);
    host.pending.get('cws')?.resolve(CAMERA);
    await flush();
    sync.apply([layer('cws', { placement: { lng: 117.06, lat: 34.27, height: 89.3, heading: 0 } })]);
    expect(host.calls).toStrictEqual(['add cws 59.7 show', 'remove cws', 'add cws 89.3 show']);
    expect(states()).toStrictEqual({ cws: 'loading' });

    const stale = host.pending.get('cws');
    sync.apply([layer('cws', { placement: { lng: 117.06, lat: 34.27, height: 89.3, heading: 0 }, attempt: 1 })]);
    // 还没加进引擎的不用移除
    expect(host.calls).toStrictEqual(['add cws 59.7 show', 'remove cws', 'add cws 89.3 show', 'add cws 89.3 show']);
    stale?.resolve(CAMERA);
    await flush();
    expect(states()).toStrictEqual({ cws: 'loading' });
  });

  it('加载中被替换的不报告结果：引擎在中止以后才交回成功或失败，也不改状态、不再通知', async () => {
    const { host, sync, statuses, states } = setup();
    host.ignoresAbort = true;

    sync.apply([layer('cws')]);
    const resolved = host.pending.get('cws');
    sync.apply([layer('cws', { attempt: 1 })]);
    const rejected = host.pending.get('cws');
    sync.apply([layer('cws', { attempt: 2 })]);
    const published = statuses.length;
    resolved?.resolve(CAMERA);
    rejected?.reject(new Error('索引 404'));
    await flush();

    expect(statuses).toHaveLength(published);
    expect(states()).toStrictEqual({ cws: 'loading' });
    expect(host.calls).toStrictEqual(['add cws 59.7 show', 'add cws 59.7 show', 'add cws 59.7 show']);
  });

  it('加载失败、数据块失败都进入 failed，只记第一条；加载中报告的失败不被就绪盖掉', async () => {
    const { host, sync } = setup();

    sync.apply([layer('a'), layer('b')]);
    const indexError = new Error('索引 404');
    host.pending.get('a')?.reject(indexError);
    sync.failed('b', new Error('数据块 1'));
    sync.failed('b', new Error('数据块 2'));
    host.pending.get('b')?.resolve(CAMERA);
    await flush();

    expect(sync.status.get('a')).toStrictEqual({ state: 'failed', error: indexError });
    const b = sync.status.get('b');
    expect(b?.state === 'failed' && b.error).toStrictEqual(new Error('数据块 1'));
    sync.failed('unknown', new Error('不在会话里的不记'));
    expect(sync.status.has('unknown')).toBe(false);
  });

  it('释放后中止进行中的加载，不再报告也不再应用', async () => {
    const { host, sync, statuses } = setup();

    sync.apply([layer('cws')]);
    const count = statuses.length;
    sync[Symbol.dispose]();
    host.pending.get('cws')?.resolve(CAMERA);
    await flush();
    sync.apply([layer('other')]);

    expect(statuses).toHaveLength(count);
    expect(sync.status).toBe(NO_SCENE_STATUS);
    expect(host.calls).toStrictEqual(['add cws 59.7 show']);
  });
});

describe('mergeSceneStatus', () => {
  it('没有泼溅时原样返回瓦片集的状态，有时合成一份新的', () => {
    const loading: TilesetStatus = { state: 'loading' };
    const tilesets: SceneStatus = new Map([['xz', loading]]);

    expect(mergeSceneStatus(tilesets, NO_SCENE_STATUS)).toBe(tilesets);
    expect([...mergeSceneStatus(tilesets, new Map([['cws', loading]]))]).toStrictEqual([
      ['xz', loading],
      ['cws', loading]
    ]);
  });
});
