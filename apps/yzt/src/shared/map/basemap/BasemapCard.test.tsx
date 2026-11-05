import { mount } from '@vue/test-utils';
import { provideMap } from '@mx/map-vue';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { JIANGSU_CAMERA } from '../jiangsu';
import { BasemapCard } from './BasemapCard';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: '0123456789abcdef0123456789abcdef' };

// 页面持有开关和"能不能显示"；浮层定位要地图上下文（没有画布）
function mountCard(visible = true, tianditu: typeof TIANDITU | null = TIANDITU) {
  const open = ref(false);
  const shown = ref(visible);
  let basemap: ReturnType<typeof useBasemap> | undefined;
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: JIANGSU_CAMERA });
    const owner = useBasemap({ tianditu });
    basemap = owner;
    return () => (
      <BasemapCard basemap={owner} open={open.value} visible={shown.value} onUpdate:open={value => (open.value = value)} />
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  return { wrapper, open, shown, basemap };
}

const card = (wrapper: ReturnType<typeof mountCard>['wrapper']) => wrapper.get('button[aria-label^="底图："]');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BasemapCard', () => {
  it('卡片写当前底图的简称、无障碍名称是全称；点击交给页面打开，打开时显示为按下', async () => {
    const { wrapper, open, basemap } = mountCard();

    expect(card(wrapper).text()).toBe('矢量');
    expect(card(wrapper).attributes('aria-label')).toBe('底图：矢量底图');
    expect(card(wrapper).attributes('aria-pressed')).toBe('false');

    await card(wrapper).trigger('click');
    expect(open.value).toBe(true);
    expect(card(wrapper).attributes('aria-pressed')).toBe('true');

    basemap?.select('imagery');
    await wrapper.vm.$nextTick();
    expect(card(wrapper).attributes('aria-label')).toBe('底图：影像底图');
  });

  it('关闭天地图时卡片写"静态"，切到无底图后写"无底图"', async () => {
    const { wrapper, basemap } = mountCard(true, null);

    expect(card(wrapper).text()).toBe('静态');
    expect(card(wrapper).attributes('aria-label')).toBe('底图：静态底图');

    basemap?.select('none');
    await wrapper.vm.$nextTick();
    expect(card(wrapper).text()).toBe('无底图');
  });

  it('不能显示时（窄屏让给另一边、地图不在看）打开着也不显示为按下', async () => {
    const { wrapper, open } = mountCard(false);
    open.value = true;
    await wrapper.vm.$nextTick();

    expect(card(wrapper).attributes('aria-pressed')).toBe('false');
  });
});
