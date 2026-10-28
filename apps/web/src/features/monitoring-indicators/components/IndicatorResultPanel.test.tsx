import { mount } from '@vue/test-utils';
import { provideMap } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, shallowRef } from 'vue';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { required } from '@/shared/testing/required';
import type { IndicatorResultOwner, IndicatorResultState, ResultLayerView } from '../composables/useIndicatorResult';
import type { IndicatorLeaf } from '../indicator-tree';
import { resultLayersOf } from '../result-layers';
import { IndicatorResultPanel } from './IndicatorResultPanel';

const INDICATOR: IndicatorLeaf = {
  kind: 'leaf',
  code: 'A-32',
  dataId: 'e3472ce215e0420baec22477cb48721b',
  name: '社区小学步行10分钟覆盖率（%）',
  disabled: false,
  status: null,
  result: '40.04%',
  reason: null
};

const LAYERS = resultLayersOf([
  { key: 'xxp', name: '社区小学', geometry: 'point' },
  { key: 'roads', name: '路网', geometry: 'line' },
  { key: 'cqjcfwa', name: '城区范围面', geometry: 'fill' }
]);

const READY: IndicatorResultState = {
  kind: 'ready',
  indicator: INDICATOR,
  result: { analysisId: INDICATOR.dataId ?? '', value: '40.04%', layers: LAYERS }
};

// 面板只显示和调用：拥有者换成可以直接设状态的假对象
function fakeOwner(initial: IndicatorResultState) {
  const state = shallowRef(initial);
  const customized = shallowRef(new Set<string>());
  const owner: IndicatorResultOwner = {
    state: computed(() => state.value),
    pointSymbol: computed(() => 'flag'),
    layers: computed(() =>
      LAYERS.map(
        (layer): ResultLayerView => ({
          layer,
          visible: true,
          color: layer.color,
          customized: customized.value.has(layer.key),
          recolorable: layer.geometry !== 'point'
        })
      )
    ),
    setVisible: vi.fn<IndicatorResultOwner['setVisible']>(),
    previewColor: vi.fn<IndicatorResultOwner['previewColor']>(),
    setColor: vi.fn<IndicatorResultOwner['setColor']>(),
    resetColor: vi.fn<IndicatorResultOwner['resetColor']>(),
    retry: vi.fn<IndicatorResultOwner['retry']>(),
    deriveGroup: () => ({ sources: {}, layers: [] })
  };
  return { owner, state, customized };
}

function mountPanel(initial: IndicatorResultState) {
  const fake = fakeOwner(initial);
  const Page = defineComponent(() => {
    provideMap({ groups: ['boundaries'], camera: JIANGSU_CAMERA });
    const boundaries = useBoundaries();
    return () => <IndicatorResultPanel result={fake.owner} boundaries={boundaries} />;
  });
  return { wrapper: mount(Page), ...fake };
}

describe('IndicatorResultPanel', () => {
  it('没有选中指标时不显示', () => {
    const { wrapper } = mountPanel({ kind: 'none' });
    expect(wrapper.find('[data-indicator-result]').exists()).toBe(false);
  });

  it('显示指标名称、计算结果和子图层；勾选控制显隐，单个点图层是旗子、不能改色', async () => {
    const { wrapper, owner } = mountPanel(READY);

    expect(wrapper.text()).toContain('社区小学步行10分钟覆盖率（%）');
    expect(wrapper.text()).toContain('40.04%');
    const rows = wrapper.findAll('li');
    const names = rows.map(row => row.get('.el-checkbox').text());
    expect(names.slice(-3)).toEqual(['社区小学', '路网', '城区范围面']);
    const school = required(rows.at(-3), '社区小学');
    expect(school.find('svg[aria-label="旗子"]').exists()).toBe(true);
    expect(school.find('.el-color-picker').exists()).toBe(false);
    expect(required(rows.at(-2), '路网').find('.el-color-picker').exists()).toBe(true);

    await required(rows.at(-2), '路网').get('.el-checkbox input').setValue(false);
    expect(owner.setVisible).toHaveBeenCalledWith('roads', false);
  });

  it('改过颜色的子图层才能恢复默认', async () => {
    const { wrapper, owner, customized } = mountPanel(READY);
    const reset = () => wrapper.get('button[aria-label="路网恢复默认颜色"]');
    expect(reset().attributes('disabled')).toBeDefined();

    customized.value = new Set(['roads']);
    await wrapper.vm.$nextTick();
    expect(reset().attributes('disabled')).toBeUndefined();
    await reset().trigger('click');
    expect(owner.resetColor).toHaveBeenCalledWith('roads');
  });

  it('加载失败时显示原因，可以重试；收起后只剩标题栏', async () => {
    const { wrapper, owner } = mountPanel({ kind: 'failed', indicator: INDICATOR, message: '成果加载失败' });
    expect(wrapper.text()).toContain('成果加载失败');
    const retry = required(
      wrapper.findAll('button').find(button => button.text() === '重试'),
      '重试按钮'
    );
    await retry.trigger('click');
    expect(owner.retry).toHaveBeenCalledTimes(1);

    await wrapper.get('button[aria-label="收起指标成果"]').trigger('click');
    expect(wrapper.text()).not.toContain('成果加载失败');
    expect(wrapper.find('button[aria-label="展开指标成果"]').exists()).toBe(true);
  });
});
