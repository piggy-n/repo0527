// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CameraState } from '../camera/camera-model';
import type { PreparedTileset } from './prepare-tileset';
import type { SceneStatus, TilesetLayer } from './scene-content-model';
import { SceneTilesetSync, type TilesetHost, type TilesetOptions } from './tileset-sync';

const CAMERA: CameraState = { center: [120, 31], zoom: 17, bearing: 0, pitch: 55 };

const tilesetJson = (id: string) => ({
  asset: { version: '1.1' },
  geometricError: 10,
  root: { boundingVolume: { sphere: [0, 0, 0, 10] }, geometricError: 0, content: { uri: `${id}.glb` } }
});

// 引擎一侧：每次加入挂起，测试决定成功还是失败
class FakeHost implements TilesetHost {
  readonly calls: string[] = [];
  readonly pending = new Map<string, { resolve: (camera: CameraState) => void; reject: (error: unknown) => void }>();
  readonly options = new Map<string, TilesetOptions>();

  addTileset(id: string, _tileset: PreparedTileset, options: TilesetOptions, signal: AbortSignal): Promise<CameraState> {
    this.calls.push(`add ${id} ${options.show ? 'show' : 'hide'}`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: camera => {
          this.options.set(id, options);
          resolve(camera);
        },
        reject
      });
      signal.addEventListener('abort', () => reject(new DOMException('加载已中止', 'AbortError')));
    });
  }

  updateTileset(id: string, options: TilesetOptions): void {
    this.calls.push(`update ${id} ${options.show ? 'show' : 'hide'} ${options.lighting}`);
    this.options.set(id, options);
  }

  removeTileset(id: string): void {
    this.calls.push(`remove ${id}`);
    this.options.delete(id);
  }

  resolve(id: string): void {
    this.pending.get(id)?.resolve(CAMERA);
  }
}

const layer = (id: string, extra: Partial<TilesetLayer> = {}): TilesetLayer => ({
  id,
  url: `https://models.test/${id}/tileset.json`,
  show: true,
  lighting: 'sun',
  attempt: 0,
  ...extra
});

// 推进到下一轮宏任务：索引的下载和整理都在微任务里完成
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(loadJson = async (url: string) => tilesetJson(new URL(url).pathname.split('/')[1] ?? '')) {
  const host = new FakeHost();
  const statuses: SceneStatus[] = [];
  const sync = new SceneTilesetSync({ host, loadJson, onStatus: status => statuses.push(status) });
  const states = () => Object.fromEntries([...sync.status].map(([id, status]) => [id, status.state]));
  return { host, sync, statuses, states };
}

describe('SceneTilesetSync', () => {
  it('新的瓦片集先报告加载中，交给引擎建好后就绪并带上建议的相机', async () => {
    const { host, sync, states } = setup();

    sync.apply([layer('station')]);
    expect(states()).toStrictEqual({ station: 'loading' });
    await flush();
    expect(host.calls).toStrictEqual(['add station show']);
    host.resolve('station');
    await flush();

    expect(sync.status.get('station')).toStrictEqual({ state: 'ready', camera: CAMERA });
  });

  it('只改显示和光照时不重新加载；换了地址或重试次数就撤下重新加载', async () => {
    const { host, sync } = setup();
    sync.apply([layer('station')]);
    await flush();
    host.resolve('station');
    await flush();

    sync.apply([layer('station', { lighting: 'headlight' })]);
    sync.apply([layer('station', { lighting: 'headlight', attempt: 1 })]);
    await flush();

    expect(host.calls).toStrictEqual([
      'add station show',
      'update station show headlight',
      'remove station',
      'add station show'
    ]);
  });

  it('索引下载失败、引擎报告瓦片失败都进入 failed；每个瓦片集只记第一条', async () => {
    const { host, sync, states } = setup(async url => {
      if (url.includes('broken')) {
        throw new Error('404');
      }
      return tilesetJson('station');
    });
    sync.apply([layer('broken'), layer('station')]);
    await flush();
    host.resolve('station');
    await flush();
    const first = new Error('瓦片 1');

    sync.failed('station', first);
    sync.failed('station', new Error('瓦片 2'));

    expect(states()).toStrictEqual({ broken: 'failed', station: 'failed' });
    expect(sync.status.get('station')).toStrictEqual({ state: 'failed', error: first });
  });

  it('同组换显示时，新的首批瓦片到了才撤下旧的', async () => {
    const { host, sync } = setup();
    sync.apply([layer('white-a', { group: 'white' })]);
    await flush();
    host.resolve('white-a');
    await flush();
    sync.initial('white-a');

    sync.apply([layer('white-a', { group: 'white', show: false }), layer('white-b', { group: 'white' })]);
    await flush();
    host.resolve('white-b');
    await flush();
    expect(host.options.get('white-a')?.show).toBe(true);
    sync.initial('white-b');

    expect(host.options.get('white-a')?.show).toBe(false);
    expect(host.options.get('white-b')?.show).toBe(true);
  });

  it('撤下、释放时中止进行中的加载，不再报告', async () => {
    const { host, sync, statuses } = setup();
    sync.apply([layer('station'), layer('white')]);
    await flush();
    sync.apply([layer('white')]);
    const reported = statuses.length;

    sync[Symbol.dispose]();
    host.resolve('white');
    await flush();

    expect(statuses).toHaveLength(reported);
    expect(sync.status.size).toBe(0);
    expect(host.calls).not.toContain('remove station');
  });
});
