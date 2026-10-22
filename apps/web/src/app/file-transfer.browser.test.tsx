import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { FileDownloadPanel } from '@/features/file-management/components/FileDownloadPanel';
import type { FileDownloadTask, useFileDownloads } from '@/features/file-management/composables/useFileDownloads';
import 'element-plus/dist/index.css';
import './styles/index.scss';

type DownloadModel = ReturnType<typeof useFileDownloads>;

/** 测量首个可见字形，避免容器居中却中文字不在同一直线 */
function firstGlyph(element: Element): DOMRect {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const start = node.textContent?.search(/\S/) ?? -1;
    if (start >= 0) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 1);
      return range.getBoundingClientRect();
    }
  }
  throw new Error('待检查元素没有文字');
}

describe('下载进度与项目主题的真实布局', () => {
  it('各状态及窄屏长错误的首行文字和操作按钮保持同一基线', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.width = '1000px';
    const phases: FileDownloadTask['phase'][] = ['receiving', 'receiving', 'checking', 'done', 'canceled', 'error'];
    const tasks = ref<FileDownloadTask[]>(phases.map((phase, index) => ({
      file: { id: String(index), name: `测试文件${index}.txt`, type: 'txt', objectKey: String(index) },
      phase,
      progress: index === 0 ? { loaded: 37, total: 100, percent: 37 } : { loaded: 32, total: null, percent: null },
      failure: '下载失败，请重试；这里是需要换行的长错误信息'
    })));
    const model: DownloadModel = {
      tasks,
      start: vi.fn<DownloadModel['start']>(async () => undefined),
      cancel: vi.fn<DownloadModel['cancel']>(),
      clearFinished: vi.fn<DownloadModel['clearFinished']>(),
      isDownloading: id =>
        tasks.value.some(task => task.file.id === id && (task.phase === 'receiving' || task.phase === 'checking'))
    };
    const wrapper = mount(FileDownloadPanel, { props: { model }, attachTo: host });
    try {
      await wrapper.get('[aria-expanded]').trigger('click');
      await document.fonts.ready;
      for (const width of [1000, 260]) {
        host.style.width = `${width}px`;
        const statuses = wrapper.findAll('[role="status"]').slice(1);
        expect(statuses).toHaveLength(phases.length);
        for (const status of statuses) {
          const text = firstGlyph(status.element);
          const button = status.element.parentElement!.querySelector('button')!;
          const action = firstGlyph(button);
          expect(Math.abs(text.top - action.top)).toBeLessThan(1);
          expect(button.getBoundingClientRect().left).toBeGreaterThan(status.element.getBoundingClientRect().left);
          expect(host.scrollWidth).toBeLessThanOrEqual(width);
        }
      }
    } finally {
      wrapper.unmount();
      host.remove();
    }
  });
});
