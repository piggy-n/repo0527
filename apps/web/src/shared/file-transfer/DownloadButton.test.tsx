import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DownloadButton } from './DownloadButton';

describe('DownloadButton', () => {
  it('下载中显示进度，总量未知时显示"下载中"；不能下载时置灰；点了发出 click', async () => {
    const idle = mount(DownloadButton, { props: { downloading: false } });
    await idle.find('button').trigger('click');
    expect(idle.text()).toBe('下载');
    expect(idle.emitted('click')).toHaveLength(1);

    expect(mount(DownloadButton, { props: { downloading: true, percent: 35 } }).text()).toBe('下载 35%');
    expect(mount(DownloadButton, { props: { downloading: true, percent: null } }).text()).toBe('下载中');
    const disabled = mount(DownloadButton, { props: { downloading: false, disabled: true } });
    expect(disabled.find('button').attributes('disabled')).toBeDefined();
  });
});
