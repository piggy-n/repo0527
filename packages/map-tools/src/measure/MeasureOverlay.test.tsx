import type { LngLat, MeasureState } from '@mx/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';
import { MeasureOverlay } from './MeasureOverlay';
import type { Measure } from './useMeasure';

// 浮层只读这几项；真实的上下文要有画布和视图，整页的流程由应用的现状底图页测试覆盖
vi.mock('@mx/map-vue', async importOriginal => ({
  ...(await importOriginal<typeof import('@mx/map-vue')>()),
  useMap: () => ({
    projectionRevision: ref(0),
    activeTool: ref('browse'),
    view: shallowRef({ project: ([x, y]: LngLat) => ({ x, y }) })
  })
}));

const STATE: MeasureState = {
  measurements: [
    {
      id: 'line-1',
      kind: 'distance',
      points: [
        [10, 20],
        [30, 40]
      ],
      method: 'geodesic',
      value: 1234
    }
  ],
  draft: null
};

function fakeMeasure(): Measure {
  return {
    tools: {} as Measure['tools'],
    state: shallowRef(STATE),
    pointer: shallowRef(null),
    remove: vi.fn<Measure['remove']>(),
    clear: vi.fn<Measure['clear']>(),
    deriveGroup: () => ({ sources: {}, layers: [] })
  };
}

describe('MeasureOverlay', () => {
  it('删除按钮里放使用方给的图标，点击删除这一条', async () => {
    const measure = fakeMeasure();
    const wrapper = mount(MeasureOverlay, {
      props: { measure },
      slots: { removeIcon: () => <svg data-test="remove-icon" /> }
    });

    const remove = wrapper.get('[aria-label="删除这条测量"]');
    expect(remove.find('[data-test="remove-icon"]').exists()).toBe(true);

    await remove.trigger('click');
    expect(measure.remove).toHaveBeenCalledExactlyOnceWith('line-1');
  });

  it('没有给图标时按钮照常可用', async () => {
    const measure = fakeMeasure();
    const wrapper = mount(MeasureOverlay, { props: { measure } });

    await wrapper.get('[aria-label="删除这条测量"]').trigger('click');
    expect(measure.remove).toHaveBeenCalledExactlyOnceWith('line-1');
  });
});
