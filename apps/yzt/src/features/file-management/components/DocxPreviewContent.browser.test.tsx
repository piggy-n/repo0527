import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { required } from '@/shared/testing/required';
import { DocxPreviewContent } from './DocxPreviewContent';
import fixtureUrl from '../fixtures/sample.docx?url';

/** 文件完全自建，真实渲染中文、图片、表格、页眉页脚和分页 */
async function fixture() {
  return (await fetch(fixtureUrl)).blob();
}

describe('DOCX 真实浏览器渲染', () => {
  it('隔离渲染、内嵌图片与分页，禁止链接和 HTML 片段，缩放不随窗口宽度改变', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.cssText = 'width:760px;height:540px';
    const controller = new AbortController();
    const loaded = vi.fn<() => void>();
    const failed = vi.fn<() => void>();
    const wrapper = mount(DocxPreviewContent, {
      props: { content: { kind: 'docx', blob: await fixture(), signal: controller.signal }, zoom: 100,
        onLoaded: loaded, onFailed: failed },
      attachTo: host
    });
    try {
      // 按需加载解析库和 iframe 就绪在并行测试时可能超过默认轮询期限
      await expect.poll(() => loaded.mock.calls.length + failed.mock.calls.length, { timeout: 10000 }).toBe(1);
      expect(failed).not.toHaveBeenCalled();
      const frame = wrapper.get('iframe').element as HTMLIFrameElement;
      const body = required(frame.contentDocument, '阅读区的文档').body;
      expect(body.textContent).toContain('自然资源调查成果说明');
      expect(body.textContent).toContain('调查监测 · 测试页眉');
      expect(body.textContent).toContain('自建测试文档 · 测试页脚');
      expect(body.querySelectorAll('table')).toHaveLength(1);
      expect(body.querySelectorAll('section.file-docx')).toHaveLength(2);
      expect(body.querySelector('img')?.src).toMatch(/^data:image\/png;base64,/);
      expect(body.querySelector('a')?.getAttribute('href')).toBeNull();
      expect(body.textContent).not.toContain('ALT_CHUNK_SHOULD_NOT_RENDER');
      expect(body.querySelector('iframe')).toBeNull();
      expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
      expect(document.querySelector('section.file-docx')).toBeNull();
      const paper = required(body.querySelector<HTMLElement>('.file-docx-wrapper'), '文档的外层容器');
      expect(Number(paper.style.zoom)).toBe(1);
      const desktopWidth = paper.getBoundingClientRect().width;
      host.style.width = '360px';
      await expect.poll(() => frame.getBoundingClientRect().width).toBe(360);
      expect(Number(paper.style.zoom)).toBe(1);
      expect(paper.getBoundingClientRect().width).toBe(desktopWidth);
      expect(body.ownerDocument.documentElement.scrollWidth).toBeGreaterThan(frame.clientWidth);
      await wrapper.setProps({ zoom: 150 });
      expect(paper.getBoundingClientRect().width).toBeCloseTo(desktopWidth * 1.5, 1);
      await wrapper.setProps({ zoom: 50 });
      expect(paper.getBoundingClientRect().width).toBeCloseTo(desktopWidth * 0.5, 1);
    } finally {
      controller.abort();
      wrapper.unmount();
      host.remove();
    }
  }, 15000);

  it('损坏 DOCX 报显示失败，销毁后不再回报成功或失败', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.cssText = 'width:760px;height:540px';
    const controller = new AbortController();
    const loaded = vi.fn<() => void>();
    const failed = vi.fn<() => void>();
    const wrapper = mount(DocxPreviewContent, {
      props: { content: { kind: 'docx', blob: new Blob(['broken']), signal: controller.signal }, zoom: 100,
        onLoaded: loaded, onFailed: failed }, attachTo: host
    });
    try {
      await expect.poll(() => failed.mock.calls.length).toBe(1);
      expect(loaded).not.toHaveBeenCalled();
      controller.abort();
      await wrapper.setProps({ content: { kind: 'docx', blob: await fixture(), signal: controller.signal } });
      wrapper.unmount();
      // 等待一个事件循环，确认取消路径不会再次提交状态
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(failed).toHaveBeenCalledTimes(1);
      expect(loaded).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      host.remove();
    }
  });
});
