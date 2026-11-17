import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { nextTick } from 'vue';
import { required } from '@/shared/testing/required';
import { LandSpaceView } from './LandSpaceView';

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
  // 详情弹窗渲染在 body 下
  document.querySelectorAll('.el-overlay').forEach(overlay => overlay.remove());
});

function createHost(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  return host;
}

// 过渡状态只有几秒：在写进 DOM 的同一轮微任务里接住（写法同 DashboardEntrance.browser.test.tsx）
function whenEntered(host: HTMLElement, attribute: string, state: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const current = host.querySelector(`[${attribute}]`)?.getAttribute(attribute);
      if (current === state) {
        resolve();
      } else if (current === 'ready') {
        reject(new Error(`${attribute} 没有经过 ${state} 就到了 ready`));
      }
    });
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: [attribute] });
    onTestFinished(() => observer.disconnect());
  });
}

function buttonByText(wrapper: VueWrapper, text: string): HTMLButtonElement {
  return required(
    wrapper.findAll('button').find(button => button.text() === text)?.element,
    `"${text}"按钮`
  );
}

function cardTitles(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[data-chart-id]').map(card => card.get('h3, [aria-haspopup="menu"]').text());
}

async function ready(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(() => expect(wrapper.attributes('data-dashboard-phase')).toBe('ready'), { timeout: 30000 });
}

describe('综合分析驾驶舱', () => {
  it('入场后三张卡都画出图表、在 1280×800 下放得下；二维降级的指北针朝正北', async () => {
    const host = createHost();
    const panelsEntering = whenEntered(host, 'data-dashboard-phase', 'panels-entering');
    const wrapper = mount(LandSpaceView, { attachTo: host, props: { forceFallback: true } });
    expect(wrapper.attributes('data-dashboard-phase')).toBe('map-entering');
    await panelsEntering;
    await ready(wrapper);
    expect(wrapper.get('h1').text()).toBe('江苏省城市国土空间监测综合分析');
    expect(wrapper.find('[aria-label="大屏筛选条件"]').attributes('inert')).toBeUndefined();
    const list = wrapper.get('[data-card-list]').element as HTMLElement;
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + 1);
    // 入场揭示后每张卡都有 ECharts 的画布
    await vi.waitFor(() => expect(list.querySelectorAll('[role="img"] canvas')).toHaveLength(3));
    expect(wrapper.text()).toContain('地图采用简化显示');
    const compass = wrapper.get('[aria-label="指北针"] svg').element as SVGElement;
    expect(compass.style.transform).toBe('');
    await vi.waitFor(() => expect(wrapper.find('[aria-label^="比例尺，全长"]').exists()).toBe(true));
    wrapper.unmount();
    expect(document.querySelectorAll('[data-dashboard-phase]')).toHaveLength(0);
  }, 60000);

  it('选一级联动二级、三张卡和地图标题；地图标签只写名称，点城市打开二级详情', async () => {
    const host = createHost();
    const wrapper = mount(LandSpaceView, { attachTo: host, props: { reducedMotion: true } });
    await ready(wrapper);
    const labels = wrapper.findAll('button[aria-haspopup="dialog"]');
    expect(labels).toHaveLength(13);
    expect(labels.filter(label => label.find('span').exists())).toEqual([]);
    expect(labels[0]?.attributes('aria-label')).toBe('南京市，查看详情');
    expect(wrapper.get('[aria-label="江苏省当前指标分布地图"] h2').text()).toBe('2025年江苏省教育便利性分布图');
    expect(cardTitles(wrapper)).toEqual(['生活宜居便利性', '教育便利性', '幼儿园步行5分钟覆盖率（%）']);
    // 三维场景算出朝向和比例后才有比例尺
    expect(wrapper.find('[aria-label="指北针"]').exists()).toBe(true);
    await vi.waitFor(() => expect(wrapper.find('[aria-label^="比例尺，全长"]').exists()).toBe(true));

    buttonByText(wrapper, '交通网络通达性').click();
    await nextTick();
    const subs = wrapper.get('[aria-label="二级指标列表"]');
    expect(subs.findAll('button').map(button => button.text())).toEqual([
      '城市内部交通设施覆盖水平',
      '城际连通水平',
      '对外交通设施水平',
      '网络便捷度',
      '城乡融合水平'
    ]);
    expect(subs.get('[aria-pressed="true"]').text()).toBe('城市内部交通设施覆盖水平');
    expect(wrapper.get('[aria-label="江苏省当前指标分布地图"] h2').text()).toBe(
      '2025年江苏省城市内部交通设施覆盖水平分布图'
    );
    expect(cardTitles(wrapper)).toEqual(['交通网络通达性', '城市内部交通设施覆盖水平', '公共交通场站面积占比（%）']);

    buttonByText(wrapper, '城乡融合水平').click();
    await nextTick();
    expect(wrapper.get('[aria-label="江苏省当前指标分布地图"] [role="status"]').text()).toBe('原报告未列指数值');
    expect(wrapper.get('[data-chart-id="sub"]').text()).toContain('原报告未列指数值');
    expect(wrapper.find('[aria-label="地图数值分级"]').exists()).toBe(false);

    buttonByText(wrapper, '网络便捷度').click();
    await nextTick();
    await wrapper.get('button[aria-label="南京市，查看详情"]').trigger('click');
    const dialog = await vi.waitFor(() => required(document.querySelector('.el-dialog'), '详情弹窗'));
    expect(dialog.querySelector('.el-dialog__body h2')?.textContent).toBe('网络便捷度');
    expect(dialog.textContent).toContain('南京市 · 当前查看城市');
    wrapper.unmount();
  }, 60000);

  it('分项栏在真实布局里横向滚动，切到最后一个分项时它完整露出，三张卡的绘图区都不小于 125 像素', async () => {
    const host = createHost();
    const wrapper = mount(LandSpaceView, { attachTo: host, props: { forceFallback: true, reducedMotion: true } });
    await ready(wrapper);
    buttonByText(wrapper, '交通网络通达性').click();
    await nextTick();
    buttonByText(wrapper, '网络便捷度').click();
    await nextTick();
    const card = wrapper.get('[data-chart-id="indicator"]');
    const scroller = card.get('[role="tablist"]').element as HTMLElement;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    const next = card.get('[aria-label="下一个分项"]').element as HTMLButtonElement;
    for (let step = 0; step < 3; step++) {
      next.click();
      // oxlint-disable-next-line no-await-in-loop -- 每次点完等选中项和滚动更新，再点下一次
      await nextTick();
    }
    expect(next.disabled).toBe(true);
    const selected = card.get('[aria-selected="true"]').element as HTMLElement;
    expect(selected.textContent).toBe('与高速公路之间距离');
    await vi.waitFor(() => {
      const view = scroller.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      expect(tab.left).toBeGreaterThanOrEqual(view.left);
      expect(tab.right).toBeLessThanOrEqual(view.right + 0.5);
    });
    // 1280×800 放不下三张卡的最小高度时列表滚动，各卡的绘图区不被分项栏挤小
    const plots = wrapper.findAll('[data-chart-id] [role="img"]').map(plot => plot.element.clientHeight);
    expect(Math.min(...plots)).toBeGreaterThanOrEqual(125);
    wrapper.unmount();
  }, 60000);
});
