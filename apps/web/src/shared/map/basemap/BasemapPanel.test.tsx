import { mount } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { describe, expect, it } from 'vitest';
import { BasemapPanel } from './BasemapPanel';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: '0123456789abcdef0123456789abcdef' };

type Wrapper = ReturnType<typeof mountPanel>['wrapper'];

function mountPanel(tianditu: typeof TIANDITU | null = TIANDITU) {
  const basemap = useBasemap({ tianditu });
  const wrapper = mount(BasemapPanel, { props: { basemap } });
  return { wrapper, basemap };
}

const options = (wrapper: Wrapper) => wrapper.findAll('[role="group"] button');

function option(wrapper: Wrapper, label: string) {
  const found = options(wrapper).find(candidate => candidate.attributes('aria-label') === label);
  if (!found) {
    throw new Error(`没有找到"${label}"`);
  }
  return found;
}

describe('BasemapPanel', () => {
  it('三张缩略图只写类型，当前的显示为按下；点一张选中它；无底图时没有透明度', async () => {
    const { wrapper, basemap } = mountPanel();

    expect(options(wrapper).map(button => button.text())).toStrictEqual(['矢量', '影像', '无底图']);
    expect(option(wrapper, '矢量底图').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.el-slider').exists()).toBe(true);

    await option(wrapper, '影像底图').trigger('click');
    expect(basemap.selected.value).toBe('imagery');
    expect(option(wrapper, '影像底图').attributes('aria-pressed')).toBe('true');
    expect(option(wrapper, '矢量底图').attributes('aria-pressed')).toBe('false');

    await option(wrapper, '无底图').trigger('click');
    expect(basemap.selected.value).toBe('none');
    expect(wrapper.find('.el-slider').exists()).toBe(false);
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
    await wrapper.vm.$nextTick();
    const slider = wrapper.findComponent(ElSlider);

    expect(slider.props('modelValue')).toBe(60);
    expect(wrapper.text()).toContain('60%');

    expect(() => slider.vm.$emit('update:modelValue', 35)).not.toThrow();
    await wrapper.vm.$nextTick();

    expect(basemap.opacity.value).toBe(0.35);
    expect(slider.props('modelValue')).toBe(35);
    expect(wrapper.text()).toContain('35%');
  });

  it('关闭天地图时是"静态"和"无底图"，默认选中静态；点一下切到无底图，透明度随之隐藏', async () => {
    const { wrapper, basemap } = mountPanel(null);

    expect(options(wrapper).map(button => button.text())).toStrictEqual(['静态', '无底图']);
    expect(option(wrapper, '静态底图').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.el-slider').exists()).toBe(true);

    await option(wrapper, '无底图').trigger('click');
    expect(basemap.selected.value).toBe('none');
    expect(option(wrapper, '静态底图').attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('.el-slider').exists()).toBe(false);

    await option(wrapper, '静态底图').trigger('click');
    expect(basemap.selected.value).toBe('static');
    expect(wrapper.find('.el-slider').exists()).toBe(true);
  });

  it('静态底图的缩略图只有一张打包的图，没有注记，也不请求天地图', () => {
    const { wrapper, basemap } = mountPanel(null);
    const style = option(wrapper, '静态底图').find('[aria-hidden="true"]').attributes('style') ?? '';

    expect(style).toContain(`url("${basemap.thumbnails.static?.base}")`);
    expect(style.match(/url\(/g)).toHaveLength(1);
    expect(style).not.toContain('null');
    expect(style).not.toContain('tianditu');
  });
});
