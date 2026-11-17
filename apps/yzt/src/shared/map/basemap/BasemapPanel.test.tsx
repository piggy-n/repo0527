import { mount } from '@vue/test-utils';
import { ElSlider, ElSwitch } from 'element-plus';
import { describe, expect, it } from 'vitest';
import type { ServerBasemapId } from '../../config/server-basemap-options';
import { BAKED_LABELS_HINT, BasemapPanel } from './BasemapPanel';
import { NO_SERVER_BASEMAPS, type ServerBasemaps } from './server-basemaps';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: '0123456789abcdef0123456789abcdef' };

// 探测到的服务器底图（ADR 0165）：缩略图是探测读到的瓦片
const servers = (...ids: ServerBasemapId[]): ServerBasemaps =>
  ids.map(id => ({ id, root: `http://intranet.test/basemap/${id}/`, thumbnail: `data:image/png;base64,${id}` }));
const ALL_FOUR = servers('standard', 'imagery', 'black', 'night-blue');

type Wrapper = ReturnType<typeof mountPanel>['wrapper'];

function mountPanel(tianditu: typeof TIANDITU | null = TIANDITU, found: ServerBasemaps = NO_SERVER_BASEMAPS) {
  const basemap = useBasemap({ tianditu, servers: found });
  const wrapper = mount(BasemapPanel, { props: { basemap } });
  return { wrapper, basemap };
}

// 缩略图的无障碍名称都以"底图"结尾；角上的入口不是
const options = (wrapper: Wrapper) => wrapper.findAll('[role="group"] button[aria-label$="底图"]');
const adjust = (wrapper: Wrapper) => wrapper.find('button[aria-label="调整标注和透明度"]');
const hints = (wrapper: Wrapper) => wrapper.findAll('span').filter(span => span.text() === BAKED_LABELS_HINT);

// ElSwitch 的开关是里面看不见的 input[role=switch]，点击由外面的根元素接
function labelsSwitch(wrapper: Wrapper): HTMLInputElement {
  const input = wrapper.get('[role="switch"]').element;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('标注开关不是 input');
  }
  return input;
}

async function clickLabelsSwitch(wrapper: Wrapper) {
  await wrapper.get('.el-switch').trigger('click');
}

function option(wrapper: Wrapper, label: string) {
  const found = options(wrapper).find(candidate => candidate.attributes('aria-label') === label);
  if (!found) {
    throw new Error(`没有找到"${label}"`);
  }
  return found;
}

describe('BasemapPanel', () => {
  it('默认只有缩略图：只写类型，当前的显示为按下，没有标注和透明度', () => {
    const { wrapper } = mountPanel();

    expect(options(wrapper).map(button => button.text())).toStrictEqual(['矢量', '影像', '无底图']);
    expect(option(wrapper, '矢量底图').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.el-slider').exists()).toBe(false);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
  });

  it('点一张缩略图选中它并告诉使用方；点当前的也告诉', async () => {
    const { wrapper, basemap } = mountPanel();

    await option(wrapper, '影像底图').trigger('click');
    expect(basemap.selected.value).toBe('imagery');
    expect(option(wrapper, '影像底图').attributes('aria-pressed')).toBe('true');
    expect(option(wrapper, '矢量底图').attributes('aria-pressed')).toBe('false');
    expect(wrapper.emitted('picked')).toHaveLength(1);

    await option(wrapper, '影像底图').trigger('click');
    expect(wrapper.emitted('picked')).toHaveLength(2);
  });

  it('入口只在当前缩略图上，跟着选择走；无底图没有入口', async () => {
    const { wrapper } = mountPanel();
    const itemOf = (label: string) => option(wrapper, label).element.parentElement;

    expect(wrapper.findAll('button[aria-label="调整标注和透明度"]')).toHaveLength(1);
    expect(adjust(wrapper).element.parentElement).toBe(itemOf('矢量底图'));

    await option(wrapper, '影像底图').trigger('click');
    expect(adjust(wrapper).element.parentElement).toBe(itemOf('影像底图'));

    await option(wrapper, '无底图').trigger('click');
    expect(adjust(wrapper).exists()).toBe(false);
  });

  it('入口不算选择底图：不告诉使用方，点开显示标注和透明度，再点收起', async () => {
    const { wrapper, basemap } = mountPanel();

    await adjust(wrapper).trigger('click');
    expect(adjust(wrapper).attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.el-slider').exists()).toBe(true);
    expect(wrapper.find('[role="switch"]').exists()).toBe(true);
    expect(wrapper.emitted('picked')).toBeUndefined();
    expect(basemap.selected.value).toBe('vector');

    await adjust(wrapper).trigger('click');
    expect(adjust(wrapper).attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('.el-slider').exists()).toBe(false);
  });

  it('浮层不显示时收起：下次打开又只有切换按钮，调过的值还在', async () => {
    const { wrapper, basemap } = mountPanel();
    await adjust(wrapper).trigger('click');
    wrapper.findComponent(ElSlider).vm.$emit('update:modelValue', 35);

    await wrapper.setProps({ active: false });
    await wrapper.setProps({ active: true });

    expect(wrapper.find('.el-slider').exists()).toBe(false);
    expect(adjust(wrapper).attributes('aria-pressed')).toBe('false');
    expect(basemap.opacity.value).toBe(0.35);
  });

  it('展开时切到无底图：标注和透明度都不显示', async () => {
    const { wrapper } = mountPanel();
    await adjust(wrapper).trigger('click');

    await option(wrapper, '无底图').trigger('click');

    expect(wrapper.find('.el-slider').exists()).toBe(false);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
  });

  it('标注开关显示拥有者的状态，切换时交给拥有者', async () => {
    const { wrapper, basemap } = mountPanel();
    await adjust(wrapper).trigger('click');
    const toggle = wrapper.findComponent(ElSwitch);

    expect(toggle.props('modelValue')).toBe(true);
    toggle.vm.$emit('update:modelValue', false);
    await wrapper.vm.$nextTick();

    expect(basemap.labelsVisible.value).toBe(false);
    expect(toggle.props('modelValue')).toBe(false);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
  });

  it('缩略图叠着注记和底图两张瓦片；无底图没有图片', () => {
    const { wrapper, basemap } = mountPanel();
    const image = (label: string) => option(wrapper, label).find('[aria-hidden="true"]').attributes('style') ?? '';

    const { vector } = basemap.thumbnails;
    expect(image('矢量底图')).toContain(`url("${vector?.labels}"), url("${vector?.base}")`);
    expect(image('无底图')).not.toContain('url(');
  });

  it('滑块按百分比显示，右边写出百分比；拖动时把 0～1 的透明度交给拥有者', async () => {
    const { wrapper, basemap } = mountPanel();
    basemap.setOpacity(0.6);
    await adjust(wrapper).trigger('click');
    const slider = wrapper.findComponent(ElSlider);

    expect(slider.props('modelValue')).toBe(60);
    expect(wrapper.text()).toContain('60%');

    expect(() => slider.vm.$emit('update:modelValue', 35)).not.toThrow();
    await wrapper.vm.$nextTick();

    expect(basemap.opacity.value).toBe(0.35);
    expect(slider.props('modelValue')).toBe(35);
    expect(wrapper.text()).toContain('35%');
  });

  it('关闭天地图时是"静态"和"无底图"，默认选中静态、标注关闭；打开标注后有地名', async () => {
    const { wrapper, basemap } = mountPanel(null);

    expect(options(wrapper).map(button => button.text())).toStrictEqual(['静态', '无底图']);
    expect(option(wrapper, '静态底图').attributes('aria-pressed')).toBe('true');

    await adjust(wrapper).trigger('click');
    const toggle = wrapper.findComponent(ElSwitch);
    expect(toggle.props('modelValue')).toBe(false);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    toggle.vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();

    expect(basemap.deriveLabelsGroup().layers.map(layer => layer.id)).toStrictEqual([
      'basemap-labels-static-county',
      'basemap-labels-static-city'
    ]);
  });

  it('静态底图的缩略图只有一张打包的图，没有注记，也不请求天地图', () => {
    const { wrapper, basemap } = mountPanel(null);
    const style = option(wrapper, '静态底图').find('[aria-hidden="true"]').attributes('style') ?? '';

    expect(style).toContain(`url("${basemap.thumbnails.static?.base}")`);
    expect(style.match(/url\(/g)).toHaveLength(1);
    expect(style).not.toContain('null');
    expect(style).not.toContain('tianditu');
  });

  it.for([
    ['四套都有', ALL_FOUR, ['标准', '影像', '静态', '黑色', '极夜蓝', '无底图'], '标准底图'],
    ['只有影像', servers('imagery'), ['影像', '静态', '无底图'], '静态底图'],
    ['只有标准', servers('standard'), ['标准', '静态', '无底图'], '标准底图'],
    ['只有黑色、极夜蓝', servers('black', 'night-blue'), ['静态', '黑色', '极夜蓝', '无底图'], '静态底图'],
    ['都没有', servers(), ['静态', '无底图'], '静态底图']
  ] as const)(
    '内网%s时按拥有者的顺序排，没有的不占位（ADR 0165 第 7 节）',
    ([, found, labels, initial]) => {
      const { wrapper } = mountPanel(null, found);

      expect(options(wrapper).map(button => button.text())).toStrictEqual(labels);
      expect(options(wrapper).filter(button => button.attributes('aria-pressed') === 'true')).toHaveLength(1);
      expect(option(wrapper, initial).attributes('aria-pressed')).toBe('true');
    }
  );

  it('四套都有时六张的无障碍名称是全称；服务器底图的缩略图只有探测读到的那块瓦片', () => {
    const { wrapper } = mountPanel(null, ALL_FOUR);

    expect(options(wrapper).map(button => button.attributes('aria-label'))).toStrictEqual([
      '标准底图',
      '影像底图',
      '静态底图',
      '黑色底图',
      '极夜蓝底图',
      '无底图'
    ]);
    const style = option(wrapper, '极夜蓝底图').find('[aria-hidden="true"]').attributes('style') ?? '';
    expect(style).toContain('url("data:image/png;base64,night-blue")');
    expect(style.match(/url\(/g)).toHaveLength(1);
  });

  it.for([
    ['标准底图', 'standard'],
    ['黑色底图', 'black'],
    ['极夜蓝底图', 'night-blue']
  ] as const)('%s的地名印在图上：标注开关显示为开、置灰不能操作，旁边写说明；透明度照常', async ([label, id]) => {
    const { wrapper, basemap } = mountPanel(null, ALL_FOUR);
    // 先打开标注：开关没置灰时点一下会把它关掉，下面"点了不变"才验得出来
    basemap.setLabelsVisible(true);
    await option(wrapper, label).trigger('click');
    await adjust(wrapper).trigger('click');

    const toggle = labelsSwitch(wrapper);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('底图标注');
    // 说明和开关在同一行，是读得到的普通文字
    const [hint, ...more] = hints(wrapper);
    expect(more).toHaveLength(0);
    expect(hint?.element.parentElement).toBe(toggle.closest('.el-switch')?.parentElement);
    expect(hint?.attributes('aria-hidden')).toBeUndefined();

    await clickLabelsSwitch(wrapper);
    expect(basemap.labelsVisible.value).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    wrapper.findComponent(ElSlider).vm.$emit('update:modelValue', 40);
    await wrapper.vm.$nextTick();
    expect(basemap.selected.value).toBe(id);
    expect(basemap.opacity.value).toBe(0.4);
  });

  it('影像、静态的标注开关照常能用、没有说明；换到印着地名的底图再换回来，标注的值不变', async () => {
    const { wrapper, basemap } = mountPanel(null, ALL_FOUR);
    await adjust(wrapper).trigger('click');
    expect(labelsSwitch(wrapper).disabled).toBe(true);

    await option(wrapper, '影像底图').trigger('click');
    expect(labelsSwitch(wrapper).disabled).toBe(false);
    expect(labelsSwitch(wrapper).getAttribute('aria-disabled')).toBe('false');
    expect(labelsSwitch(wrapper).getAttribute('aria-checked')).toBe('false');
    expect(hints(wrapper)).toHaveLength(0);

    await clickLabelsSwitch(wrapper);
    expect(basemap.labelsVisible.value).toBe(true);
    expect(basemap.deriveLabelsGroup().layers).not.toStrictEqual([]);

    await option(wrapper, '黑色底图').trigger('click');
    expect(labelsSwitch(wrapper).disabled).toBe(true);
    expect(hints(wrapper)).toHaveLength(1);
    expect(basemap.labelsVisible.value).toBe(true);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    await option(wrapper, '静态底图').trigger('click');
    expect(labelsSwitch(wrapper).disabled).toBe(false);
    expect(labelsSwitch(wrapper).getAttribute('aria-checked')).toBe('true');
    expect(hints(wrapper)).toHaveLength(0);

    await clickLabelsSwitch(wrapper);
    expect(basemap.labelsVisible.value).toBe(false);
    await option(wrapper, '标准底图').trigger('click');
    expect(labelsSwitch(wrapper).getAttribute('aria-checked')).toBe('true');
    expect(basemap.labelsVisible.value).toBe(false);
  });
});
