import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import { DownloadPreviewPanel } from './TransferPreview';
import { useDownloadPreview, type PreviewSample } from './useTransferPreview';

const sample: PreviewSample = { id: 'one', name: '测试说明.txt', type: 'txt', year: '2026', tag: '综合' };
const scopes: EffectScope[] = [];

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.useRealTimers();
});

describe('下载进度展开规则', () => {
  it('首项、新增项与状态变化不展开，手动开关后仍保持用户的选择', async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    scopes.push(scope);
    const model = scope.run(useDownloadPreview)!;
    const wrapper = mount(DownloadPreviewPanel, { props: { model } });
    expect(wrapper.find('section').exists()).toBe(false);
    model.start(sample);
    await nextTick();
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.text()).not.toContain(sample.name);
    model.start({ ...sample, id: 'two', name: '第二个文件.txt' });
    vi.advanceTimersByTime(6000);
    await nextTick();
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');

    await wrapper.get('[aria-expanded]').trigger('click');
    expect(wrapper.text()).toContain(sample.name);
    model.showStates(sample);
    await nextTick();
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.text()).toContain('下载失败，请重试');

    await wrapper.get('[aria-expanded]').trigger('click');
    model.start({ ...sample, id: 'three' });
    await nextTick();
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.text()).not.toContain('下载失败，请重试');
  });
});
