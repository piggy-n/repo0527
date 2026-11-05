import 'element-plus/dist/index.css';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { Application } from '../api';
import { ApplicationTable } from './ApplicationTable';

// 真实的布局（ADR 0040）：操作列固定两格，"查看"和下载中的进度放得下、不挤到另一格

// 与页面一致的令牌，feature 测试不反向导入 app
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--font-size-xs': '12px',
  '--color-primary': '#597ef7'
};

function application(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id,
    name: '医疗机构面层',
    applicant: '王立',
    department: '江苏省基础地理信息中心',
    layerCode: 'csxhjctb_yljga_2022',
    region: '江苏省苏州市',
    appliedAt: '2026-10-25 14:20:31',
    startTime: '2026-10-25 08:00:00',
    endTime: '2026-12-31 23:59:59',
    formats: ['excel'],
    purpose: '医疗资源布局评估',
    status: 'approved',
    reason: '',
    prepare: 'success',
    ...overrides
  };
}

const mounted: VueWrapper[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  hosts.splice(0).forEach(host => host.remove());
});

describe('ApplicationTable 的操作列', () => {
  it('下载到 100% 时进度仍在第二格里，不压到"查看"', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    hosts.push(host);
    Object.assign(host.style, { display: 'flex', flexDirection: 'column', width: '1200px', height: '400px' });
    Object.entries(TOKENS).forEach(([name, value]) => host.style.setProperty(name, value));
    const downloads = {
      isDownloading: (id: string) => id !== 'idle',
      percentOf: (id: string) => (id === 'full' ? 100 : null)
    };
    const wrapper = mount(ApplicationTable, {
      props: {
        applications: [application('idle'), application('full'), application('unknown')],
        firstSerial: 1,
        initialLoading: false,
        refreshing: false,
        error: false,
        downloads
      },
      attachTo: host
    });
    mounted.push(wrapper);
    await expect.poll(() => host.querySelectorAll('.el-table__body tr').length).toBe(3);

    const cells = [...host.querySelectorAll('.el-table__body tr')].map(row => {
      const actions = [...row.querySelectorAll('td:last-child .cell > div > span')];
      return actions.map(span => {
        const box = span.getBoundingClientRect();
        const content = span.firstElementChild?.getBoundingClientRect() ?? box;
        // 半个像素的取整误差不算超出
        const fits = content.right <= box.right + 0.5 && content.left >= box.left - 0.5;
        return { text: span.textContent?.trim() ?? '', fits };
      });
    });
    expect(cells.map(row => row.map(cell => cell.text))).toEqual([
      ['查看', '下载'],
      ['查看', '下载 100%'],
      ['查看', '下载中']
    ]);
    expect(cells.flat().every(cell => cell.fits)).toBe(true);
  });
});
