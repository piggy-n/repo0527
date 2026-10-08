import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { useFileRemoval } from './useFileRemoval';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => {
  server.close();
});

// 删除请求挂起，调用 release 才返回
function holdDeletes() {
  const deleted: string[] = [];
  const held: (() => void)[] = [];
  server.use(
    mock.get('/backend/file/delete', async ({ request }) => {
      deleted.push(new URL(request.url).searchParams.get('id') ?? '');
      await new Promise<void>(resolve => {
        held.push(resolve);
      });
      return HttpResponse.json({ code: 200, data: null, msg: '删除成功', success: true });
    })
  );
  const release = () => {
    for (const resolve of held.splice(0)) {
      resolve();
    }
  };
  return { deleted, release };
}

let removal: ReturnType<typeof useFileRemoval>;

const Host = defineComponent({
  setup() {
    removal = useFileRemoval();
    return () => null;
  }
});

function mountHost(expiresAt = Date.now() + 3_600_000) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(expiresAt),
    user: { loginName: 'zhangsan', role: Role.user }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
}

// 确认框挂起，由用例决定确认还是取消
function deferredConfirm() {
  const answers: ((confirmed: boolean) => void)[] = [];
  const confirm = vi.fn<() => Promise<boolean>>(
    () =>
      new Promise<boolean>(resolve => {
        answers.push(resolve);
      })
  );
  return { confirm, answer: (confirmed: boolean) => answers.shift()?.(confirmed) };
}

const confirmed = () => Promise.resolve(true);

// 断言"没有发出请求"前多等一会儿：请求比 Promise 的回调晚几轮才发出
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('useFileRemoval', () => {
  it('同一个文件还在确认时再次删除：直接返回，不再确认', async () => {
    holdDeletes();
    mountHost();
    const dialog = deferredConfirm();

    const first = removal.remove('a', dialog.confirm);
    const second = removal.remove('a', dialog.confirm);
    await flushPromises();

    expect(dialog.confirm).toHaveBeenCalledOnce();
    expect(await second).toBe(false);
    dialog.answer(false);
    expect(await first).toBe(false);
  });

  it('同一个文件还在删除时再次删除：直接返回，只发一次请求', async () => {
    const { deleted, release } = holdDeletes();
    mountHost();

    const first = removal.remove('a', confirmed);
    await vi.waitFor(() => expect(deleted).toEqual(['a']));
    expect(removal.isRemoving('a')).toBe(true);
    const second = removal.remove('a', confirmed);
    await settle();

    expect(deleted).toEqual(['a']);
    release();
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(removal.isRemoving('a')).toBe(false);
  });

  it('同时删除多个文件：各自记录删除中的状态', async () => {
    const { deleted, release } = holdDeletes();
    mountHost();

    const both = Promise.all([removal.remove('a', confirmed), removal.remove('b', confirmed)]);
    await vi.waitFor(() => expect(deleted).toHaveLength(2));

    expect([removal.isRemoving('a'), removal.isRemoving('b'), removal.isRemoving('c')]).toEqual([true, true, false]);
    release();
    expect(await both).toEqual([true, true]);
    expect([removal.isRemoving('a'), removal.isRemoving('b')]).toEqual([false, false]);
  });

  it('确认期间组件已销毁：不删除', async () => {
    const { deleted } = holdDeletes();
    const wrapper = mountHost();
    const dialog = deferredConfirm();

    const pending = removal.remove('a', dialog.confirm);
    wrapper.unmount();
    dialog.answer(true);
    await settle();

    expect(deleted).toEqual([]);
    expect(await pending).toBe(false);
  });

  it('确认期间会话已结束或更换：不删除', async () => {
    const { deleted } = holdDeletes();
    mountHost();
    const dialog = deferredConfirm();

    const pending = removal.remove('a', dialog.confirm);
    useSessionStore().start({
      token: createTestJwtExpiringAt(Date.now() + 7_200_000),
      user: { loginName: 'lisi', role: Role.user }
    });
    dialog.answer(true);
    await settle();

    expect(deleted).toEqual([]);
    expect(await pending).toBe(false);
  });

  it('会话没变、token 只是已过期：照常请求，由 http 按登录过期处理', async () => {
    const { deleted, release } = holdDeletes();
    mountHost(Date.now() - 1000);

    const pending = removal.remove('a', confirmed);
    await vi.waitFor(() => expect(deleted).toEqual(['a']));

    release();
    await pending;
  });
});
