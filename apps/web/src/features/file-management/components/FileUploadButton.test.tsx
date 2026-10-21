import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { ElDialog, ElMessage, ElSelect, ElUpload } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { DEFAULT_CATEGORY_ID } from '../categories';
import { FileUploadButton } from './FileUploadButton';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); localStorage.clear(); document.body.innerHTML = ''; });
afterAll(() => server.close());

async function openUpload() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000), user: { loginName: 'test', role: Role.user }
  });
  const queryClient = new QueryClient();
  const wrapper = mount(FileUploadButton, {
    props: { categoryId: DEFAULT_CATEGORY_ID }, attachTo: document.body,
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] }
  });
  await wrapper.get('button').trigger('click');
  await flushPromises();
  return wrapper;
}

// 弹窗传送到 body，避免嵌入外层查询表单；测试保留真实 Teleport
const dialog = () => new DOMWrapper(document.body).get('.el-dialog');

/** 模拟组件发出的用户选择事件，不模拟请求实现 */
async function fillUpload(wrapper: Awaited<ReturnType<typeof openUpload>>) {
  wrapper.getComponent(ElUpload).vm.$emit('change', { raw: new File(['固定内容'], '测试.txt') });
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', '综合');
  await dialog().get('textarea').setValue('本次备注');
  await flushPromises();
}

describe('正式上传入口', () => {
  it.each(['footer', 'header'] as const)('%s 关闭清空文件和填写，标题复用 MxTitle 且不展示上传人', async action => {
    const wrapper = await openUpload();
    await fillUpload(wrapper);
    expect(wrapper.findComponent({ name: 'MxTitle' }).text()).toBe('上传文件');
    expect(dialog().text()).not.toContain('上传人');
    if (action === 'footer') {
      await dialog().get('.el-dialog__footer button').trigger('click');
    } else {
      await dialog().get('.el-dialog__headerbtn').trigger('click');
    }
    await flushPromises();
    expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(false);
    await wrapper.get('button').trigger('click');
    expect(dialog().get<HTMLTextAreaElement>('textarea').element.value).toBe('');
    expect(dialog().findAll('li')).toHaveLength(0);
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe('');
  });

  it('开始上传连接真实 mutation，成功仅显示确认，不推断返回数量', async () => {
    const requests: string[] = [];
    server.use(mock.post('/backend/file/upload', async ({ request }) => {
      requests.push(await request.text());
      return HttpResponse.json({ code: 200 });
    }));
    const wrapper = await openUpload();
    await fillUpload(wrapper);
    await dialog().get('.el-dialog__footer button.el-button--primary').trigger('click');
    await vi.waitFor(() => expect(dialog().text()).toContain('上传成功'));
    expect(requests).toHaveLength(1);
    // 文件名由 API 的 FormData 契约测试检查，jsdom 的 XHR 序列化会将其改为 blob
    expect(requests[0]).toContain('name="files"');
    expect(requests[0]).toContain('name="categoryId"\r\n\r\ntechnical-standard-current-survey');
    expect(dialog().text()).toContain('继续上传');
    expect(dialog().text()).not.toContain('文件列表已更新');
  });

  it('关窗后的失败给出一次提示，草稿不恢复', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
    let release: (() => void) | undefined;
    server.use(mock.post('/backend/file/upload', async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return HttpResponse.json({ code: 500, msg: '上传失败' });
    }));
    const wrapper = await openUpload();
    await fillUpload(wrapper);
    await dialog().get('.el-dialog__footer button.el-button--primary').trigger('click');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await dialog().get('.el-dialog__footer button').trigger('click');
    release?.();
    await vi.waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith('上传失败，请先核对列表再决定是否重试'));
    await wrapper.get('button').trigger('click');
    expect(dialog().get<HTMLTextAreaElement>('textarea').element.value).toBe('');
    expect(dialog().findAll('li')).toHaveLength(0);
  });
});
