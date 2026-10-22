import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import * as transfer from '@/shared/file-transfer';
import { configureHttp } from '@/shared/http/configure';
import { ApiError } from '@/shared/http/errors';
import * as api from '../api';
import { FilePreviewDialog } from '../components/FilePreviewDialog';
import { FileDownloadPanel } from '../components/FileDownloadPanel';
import { useFileDownloads } from './useFileDownloads';
import { useFilePreview } from './useFilePreview';

const file = { id: 'one', name: '资料.pdf', type: 'pdf', objectKey: 'one' };
const server = setupServer();
const cleanups: (() => void)[] = [];
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  server.resetHandlers();
  localStorage.clear();
  configureHttp({});
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 真正的 QueryClient 与会话，HTTP 集成用 MSW，竞态单独用不响应取消的 API 假实现 */
function setup(renderDialog = false) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({ token: createTestJwtExpiringAt(Date.now() + 3600000), user: { loginName: 'test', role: Role.user } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
  const save = vi.spyOn(transfer, 'saveFile').mockImplementation(() => undefined);
  const createUrl = vi.fn<typeof URL.createObjectURL>(() => `blob:test-${crypto.randomUUID()}`);
  const revokeUrl = vi.fn<typeof URL.revokeObjectURL>();
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createUrl;
    static override revokeObjectURL = revokeUrl;
  });
  let downloads!: ReturnType<typeof useFileDownloads>;
  let preview!: ReturnType<typeof useFilePreview>;
  const wrapper = mount(defineComponent({ setup() {
    downloads = useFileDownloads();
    preview = useFilePreview();
    return () => renderDialog ? <>
      <FileDownloadPanel model={downloads} />
      <FilePreviewDialog model={preview} downloads={downloads} />
    </> : null;
  } }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
  cleanups.push(() => {
    if (!wrapper.vm.$.isUnmounted) {
      wrapper.unmount();
    }
    queryClient.clear();
  });
  return { downloads, preview, session, queryClient, save, createUrl, revokeUrl, wrapper };
}

/** 手动释放结果以验证晚到结果不会保存或覆盖当前目标 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('文件下载', () => {
  it('进度区默认收起，新任务及完成失败不展开，手动开关保持用户选择', async () => {
    const env = setup(true);
    const request = vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob(['ok']), fileName: file.name });
    const panel = env.wrapper.findComponent(FileDownloadPanel);
    expect(panel.find('section').exists()).toBe(false);
    await env.downloads.start(file);
    await nextTick();
    expect(panel.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
    expect(panel.text()).not.toContain(file.name);
    request.mockRejectedValueOnce(new ApiError({ kind: 'business', message: '文件不存在' }));
    await env.downloads.start({ ...file, id: 'two' });
    await nextTick();
    expect(panel.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
    await panel.get('[aria-expanded]').trigger('click');
    expect(panel.text()).toContain('文件不存在');
    expect(panel.text()).toContain('已交给浏览器保存');
    await env.downloads.start({ ...file, id: 'three' });
    await nextTick();
    expect(panel.get('[aria-expanded]').attributes('aria-expanded')).toBe('true');
    await panel.get('[aria-expanded]').trigger('click');
    await env.downloads.start({ ...file, id: 'four' });
    await nextTick();
    expect(panel.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
  });

  it('用真实 HTTP 取得文件交给保存，结束后不留二进制查询缓存', async () => {
    const env = setup();
    const handler = vi.fn<() => Response>(() => new HttpResponse('content', {
      headers: { 'Content-Type': 'application/pdf' }
    }));
    server.use(mock.get('/backend/file/download', handler));
    await env.downloads.start(file);
    expect(env.downloads.tasks.value[0]?.phase).toBe('done');
    expect(env.save).toHaveBeenCalledTimes(1);
    expect(env.save.mock.calls[0]?.[0].blob).toBeInstanceOf(Blob);
    expect(env.save.mock.calls[0]?.[0].fileName).toBe('资料.pdf');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(env.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('100% 只进入检查；失败不保存、不自动重试，可手动重试', async () => {
    const env = setup();
    const held = deferred<transfer.DownloadedFile>();
    const request = vi.spyOn(api, 'fetchFileContent').mockImplementation((_file, _signal, onProgress) => {
      onProgress?.({ loaded: 10, total: 10, percent: 100 });
      return held.promise;
    });
    const done = env.downloads.start(file);
    await vi.waitFor(() => expect(env.downloads.tasks.value[0]?.phase).toBe('checking'));
    expect(env.save).not.toHaveBeenCalled();
    held.resolve({ blob: new Blob(['ok']), fileName: file.name });
    await done;
    request.mockRejectedValueOnce(new ApiError({ kind: 'business', message: '文件不存在' }));
    await env.downloads.start(file);
    expect(env.downloads.tasks.value[0]).toMatchObject({ phase: 'error', failure: '文件不存在' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(env.save).toHaveBeenCalledTimes(1);
    await env.downloads.start(file);
    expect(env.downloads.tasks.value[0]?.phase).toBe('done');
    expect(env.save).toHaveBeenCalledTimes(2);
  });

  it('同一文件防重复，取消后的旧响应不能保存或移除重试任务', async () => {
    const env = setup();
    const old = deferred<transfer.DownloadedFile>();
    const next = deferred<transfer.DownloadedFile>();
    const request = vi.spyOn(api, 'fetchFileContent')
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = env.downloads.start(file);
    await env.downloads.start(file);
    expect(request).toHaveBeenCalledTimes(1);
    env.downloads.cancel(env.downloads.tasks.value[0]);
    expect(request.mock.calls[0]?.[1].aborted).toBe(true);
    const second = env.downloads.start(file);
    old.resolve({ blob: new Blob(['old']), fileName: 'old.pdf' });
    await first;
    await env.downloads.start(file);
    expect(request).toHaveBeenCalledTimes(2);
    expect(env.save).not.toHaveBeenCalled();
    next.resolve({ blob: new Blob(['new']), fileName: 'new.pdf' });
    await second;
    expect(env.save).toHaveBeenCalledTimes(1);
    expect(env.save.mock.calls[0]?.[0].fileName).toBe('new.pdf');
  });

  it('不同文件和预览独立取消；未知总量保留 null', async () => {
    const env = setup();
    const held = deferred<transfer.DownloadedFile>();
    const request = vi.spyOn(api, 'fetchFileContent').mockImplementation((_file, _signal, progress) => {
      progress?.({ loaded: 20, total: null, percent: null });
      return held.promise;
    });
    const first = env.downloads.start(file);
    const second = env.downloads.start({ ...file, id: 'two' });
    const preview = env.preview.open(file);
    expect(env.downloads.tasks.value[0]?.progress).toEqual({ loaded: 20, total: null, percent: null });
    env.downloads.cancel(env.downloads.tasks.value.find(task => task.file.id === 'one')!);
    expect(request.mock.calls.map(call => call[1].aborted)).toEqual([true, false, false]);
    env.preview.close();
    expect(request.mock.calls.map(call => call[1].aborted)).toEqual([true, false, true]);
    env.downloads.clearFinished();
    expect(env.downloads.tasks.value).toHaveLength(1);
    held.resolve({ blob: new Blob(['ok']), fileName: file.name });
    await Promise.all([first, second, preview]);
    expect(env.save).toHaveBeenCalledTimes(1);
    expect(env.createUrl).not.toHaveBeenCalled();
  });
});

describe('预览与会话边界', () => {
  it.each(['docx', 'png'])('%s 仅保留加减缩放，关闭后的下一文件从 100% 开始', async type => {
    const env = setup(true);
    vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob(['content']), fileName: 'test.docx' });
    await env.preview.open({ ...file, name: `测试文件.${type}`, type });
    expect(env.preview.content.value).not.toBeNull();
    env.preview.rendered(env.preview.content.value!);
    await nextTick();
    const dialog = document.querySelector('.el-dialog')!;
    const labels = () => Array.from(dialog.querySelectorAll('button')).map(button => button.textContent?.trim());
    expect(labels()).not.toContain('适合宽度');
    expect(dialog.textContent).not.toContain('上下滚动阅读');
    expect(dialog.textContent).not.toContain('无法正常显示时可下载后查看');
    const name = Array.from(dialog.querySelectorAll('span')).find(span => span.textContent === `测试文件.${type}`)!;
    expect(name.parentElement?.querySelector('.el-tag')?.textContent).toBe(type.toUpperCase());
    dialog.querySelector<HTMLButtonElement>('[aria-label="缩小"]')!.click();
    await nextTick();
    expect(env.preview.zoom.value).toBe(75);
    env.preview.close();
    await env.preview.open({ ...file, id: 'two', type });
    env.preview.rendered(env.preview.content.value!);
    await nextTick();
    expect(labels()).not.toContain('适合宽度');
    expect(env.preview.zoom.value).toBe(100);
  });

  it('旧图片的晚到 load 不写入新图片的显示尺寸', async () => {
    const env = setup(true);
    vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob(['image']), fileName: 'image.png' });
    await env.preview.open({ ...file, type: 'png' });
    await nextTick();
    const oldImage = document.querySelector('img')!;
    expect(oldImage).not.toBeNull();
    Object.defineProperty(oldImage, 'naturalWidth', { value: 900 });
    await env.preview.open({ ...file, id: 'two', type: 'png' });
    await nextTick();
    const nextImage = document.querySelector('img')!;
    expect(nextImage).not.toBe(oldImage);
    expect(nextImage.style.width).toBe('0px');
    oldImage.dispatchEvent(new Event('load'));
    await nextTick();
    expect(nextImage.style.width).toBe('0px');
    expect(env.preview.phase.value).toBe('rendering');
  });

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])('图片 %s 可预览、关闭释放 URL，仍可独立下载', async type => {
    const env = setup();
    const target = { ...file, name: `图片.${type}`, type };
    const request = vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob(['image']), fileName: target.name });
    await env.preview.open(target);
    expect(request).toHaveBeenCalledOnce();
    expect(env.preview.content.value?.kind).toBe('image');
    expect(env.createUrl).toHaveBeenCalledOnce();
    env.preview.close();
    expect(env.revokeUrl).toHaveBeenCalledOnce();
    await env.downloads.start(target);
    expect(env.save).toHaveBeenCalledOnce();
    expect(env.save.mock.calls[0]?.[0].fileName).toBe(target.name);
  });

  it('每次成功取流只创建一个 URL；关闭、替换、显示失败会释放', async () => {
    const env = setup();
    vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob(['pdf']), fileName: file.name });
    await env.preview.open(file);
    const first = env.preview.content.value!;
    expect(env.preview.phase.value).toBe('rendering');
    env.preview.rendered(first);
    expect(env.preview.phase.value).toBe('ready');
    await env.preview.open(file);
    expect(env.revokeUrl).toHaveBeenCalledTimes(1);
    const second = env.preview.content.value!;
    env.preview.renderFailed(first);
    expect(env.preview.content.value).toBe(second);
    env.preview.renderFailed(second);
    expect(env.preview.phase.value).toBe('error');
    expect(env.revokeUrl).toHaveBeenCalledTimes(2);
    await env.preview.retry();
    env.preview.close();
    expect(env.revokeUrl).toHaveBeenCalledTimes(3);
    expect(env.preview.content.value).toBeNull();
  });

  it('后打开的目标作废旧取流，关闭后不创建 URL 或重新开窗', async () => {
    const env = setup();
    const held = deferred<transfer.DownloadedFile>();
    const request = vi.spyOn(api, 'fetchFileContent').mockReturnValue(held.promise);
    const first = env.preview.open(file);
    const second = env.preview.open({ ...file, id: 'two' });
    expect(request.mock.calls[0]?.[1].aborted).toBe(true);
    env.preview.close();
    held.resolve({ blob: new Blob(['content']), fileName: file.name });
    await Promise.all([first, second]);
    expect(env.preview.visible.value).toBe(false);
    expect(env.preview.file.value).toBeNull();
    expect(env.createUrl).not.toHaveBeenCalled();
  });

  it('读取真实 TXT 作为纯文本，空文本有可区分的就绪状态', async () => {
    const env = setup();
    server.use(mock.get('/backend/file/download', () => new HttpResponse('<script>普通文本</script>\n中文', {
      headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=test.txt' }
    })));
    await env.preview.open({ ...file, type: 'txt' });
    expect(env.preview.content.value).toMatchObject({ kind: 'text', text: '<script>普通文本</script>\n中文' });
    expect(env.preview.phase.value).toBe('ready');
    vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob([]), fileName: 'empty.txt' });
    await env.preview.open({ ...file, type: 'txt' });
    expect(env.preview.content.value).toMatchObject({ kind: 'text', text: '' });
    expect(env.createUrl).not.toHaveBeenCalled();
  });

  it('不支持格式不取流；空 DOCX 进入失败而不是一直加载', async () => {
    const env = setup();
    const request = vi.spyOn(api, 'fetchFileContent').mockResolvedValue({ blob: new Blob([]), fileName: 'empty.docx' });
    await env.preview.open({ ...file, type: 'xlsx' });
    expect(request).not.toHaveBeenCalled();
    expect(env.preview.phase.value).toBe('error');
    await env.preview.open({ ...file, type: 'docx' });
    expect(env.preview.failure.value).toBe('文件内容为空，无法预览');
  });

  it.each(['session', 'unmount'] as const)('%s 后忽略进度、读取和保存的晚到结果', async reason => {
    const env = setup();
    const held = deferred<transfer.DownloadedFile>();
    const request = vi.spyOn(api, 'fetchFileContent').mockReturnValue(held.promise);
    const download = env.downloads.start(file);
    const preview = env.preview.open(file);
    if (reason === 'session') {
      env.session.start({ token: createTestJwtExpiringAt(Date.now() + 7200000), user: { loginName: 'new', role: Role.user } });
    } else {
      env.wrapper.unmount();
    }
    for (const call of request.mock.calls) {
      call[2]?.({ loaded: 100, total: 100, percent: 100 });
    }
    held.resolve({ blob: new Blob(['content']), fileName: file.name });
    await Promise.all([download, preview]);
    expect(env.save).not.toHaveBeenCalled();
    expect(env.createUrl).not.toHaveBeenCalled();
    expect(env.downloads.tasks.value).toEqual([]);
    expect(env.preview.visible.value).toBe(false);
    expect(env.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('只是过期不中断已发出的读取：服务端已经接受，内容照常交给保存', async () => {
    const env = setup();
    const held = deferred<transfer.DownloadedFile>();
    vi.spyOn(api, 'fetchFileContent').mockReturnValue(held.promise);
    const download = env.downloads.start(file);
    vi.spyOn(env.session, 'isActive').mockReturnValue(false);
    held.resolve({ blob: new Blob(['content']), fileName: file.name });
    await download;
    expect(env.save).toHaveBeenCalledOnce();
    expect(env.downloads.tasks.value[0]?.phase).toBe('done');
  });

  it.each(['download', 'preview'] as const)('过期后再%s：交给 shared/http 结束会话，界面随之清空而不是没有反应', async action => {
    const env = setup();
    // 和 app/http.ts 一样按会话判断过期；结束会话由 onUnauthorized 负责
    vi.spyOn(env.session, 'isActive').mockReturnValue(false);
    const onUnauthorized = vi.fn<() => void>(() => env.session.clear());
    configureHttp({ isCredentialExpired: () => !env.session.isActive(), onUnauthorized });
    if (action === 'download') {
      await env.downloads.start(file);
    } else {
      await env.preview.open(file);
    }
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(env.downloads.tasks.value).toEqual([]);
    expect(env.preview.visible.value).toBe(false);
    expect(env.save).not.toHaveBeenCalled();
  });
});
