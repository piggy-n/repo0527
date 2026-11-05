import { getWorkerCount } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { workerCountFor } from './map-runtime';

// test-setup.browser.ts 已经调用过 setupMapRuntime；核数不超过 3 时公式和 MapLibre 的默认值都是 1，这条用例区分不了
describe('setupMapRuntime', () => {
  it('按核数设置了 MapLibre 的 Worker 数量', () => {
    expect(getWorkerCount()).toBe(workerCountFor(navigator.hardwareConcurrency));
  });
});
