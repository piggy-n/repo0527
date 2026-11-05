import { mount } from '@vue/test-utils';
import { provideMap } from '@mx/map-vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
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

// 浮层挂在 body 下
const panelButton = (label: string) =>
  document.querySelector<HTMLButtonElement>(`[data-map-options="basemap"] button[aria-label="${label}"]`);

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

  it('选了底图就关闭，焦点回到卡片；点当前底图也一样', async () => {
    const { wrapper, open, basemap } = mountCard();
    await card(wrapper).trigger('click');
    await vi.waitFor(() => expect(panelButton('影像底图')).not.toBeNull());

    panelButton('影像底图')?.click();
    await nextTick();

    expect(basemap?.selected.value).toBe('imagery');
    expect(open.value).toBe(false);
    expect(card(wrapper).attributes('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(card(wrapper).element);

    await card(wrapper).trigger('click');
    await vi.waitFor(() => expect(panelButton('影像底图')).not.toBeNull());
    panelButton('影像底图')?.click();
    await nextTick();

    expect(open.value).toBe(false);
  });

  it('角上的入口、标注开关不关闭浮层；关闭后再打开又是收起的', async () => {
    const { wrapper, open, basemap } = mountCard();
    await card(wrapper).trigger('click');
    await vi.waitFor(() => expect(panelButton('调整标注和透明度')).not.toBeNull());

    panelButton('调整标注和透明度')?.click();
    await nextTick();

    expect(open.value).toBe(true);
    expect(panelButton('调整标注和透明度')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-map-options="basemap"] [role="switch"]')).not.toBeNull();
    expect(basemap?.labelsVisible.value).toBe(true);

    await card(wrapper).trigger('click');
    expect(open.value).toBe(false);
    await card(wrapper).trigger('click');
    await nextTick();
    expect(panelButton('调整标注和透明度')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('单击外部关闭，焦点不抢回卡片；再点卡片关闭', async () => {
    const { wrapper, open } = mountCard();
    const outside = document.createElement('button');
    document.body.append(outside);
    await card(wrapper).trigger('click');
    await vi.waitFor(() => expect(panelButton('影像底图')).not.toBeNull());

    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await nextTick();
    expect(open.value).toBe(false);
    expect(document.activeElement).not.toBe(card(wrapper).element);

    await card(wrapper).trigger('click');
    expect(open.value).toBe(true);
    await card(wrapper).trigger('click');
    expect(open.value).toBe(false);
  });

  it('按 Esc 关闭，焦点回到卡片', async () => {
    const { wrapper, open } = mountCard();
    await card(wrapper).trigger('click');
    await vi.waitFor(() => expect(panelButton('影像底图')).not.toBeNull());

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();

    expect(open.value).toBe(false);
    expect(document.activeElement).toBe(card(wrapper).element);
  });

  it('不能显示时（窄屏让给另一边、地图不在看）打开着也不显示为按下', async () => {
    const { wrapper, open } = mountCard(false);
    open.value = true;
    await wrapper.vm.$nextTick();

    expect(card(wrapper).attributes('aria-pressed')).toBe('false');
  });
});
