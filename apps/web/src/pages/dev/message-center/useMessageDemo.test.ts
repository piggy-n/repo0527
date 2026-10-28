// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { required } from '@/shared/testing/required';
import { useMessageDemo } from './useMessageDemo';

afterEach(() => {
  vi.useRealTimers();
});

const firstUnread = (demo: ReturnType<typeof useMessageDemo>) =>
  required(
    demo.center.visible.value.find(message => !message.read),
    '一条未读消息'
  );

describe('useMessageDemo', () => {
  it('列表状态只影响列表，角标照常', () => {
    const demo = useMessageDemo({ onReadError: () => undefined });
    const unread = demo.center.unreadCount.value;
    expect(unread).toBeGreaterThan(0);

    demo.listScene.value = 'loading';
    expect(demo.center.initialLoading.value).toBe(true);
    demo.listScene.value = 'empty';
    expect(demo.center.filteredCount.value).toBe(0);
    expect(demo.center.unreadCount.value).toBe(unread);
    demo.listScene.value = 'error';
    expect(demo.center.loadFailed.value).toBe(true);

    demo.center.retry();
    expect(demo.center.loadFailed.value).toBe(false);
    expect(demo.center.visible.value.length).toBeGreaterThan(0);
  });

  it('已读成功后才去掉未读；失败时提示并保留未读', async () => {
    vi.useFakeTimers();
    const reasons: string[] = [];
    const demo = useMessageDemo({ onReadError: reason => reasons.push(reason) });
    const unread = demo.center.unreadCount.value;

    const message = firstUnread(demo);
    const done = demo.center.markRead(message);
    expect(demo.center.isReading(message.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(await done).toBe(true);
    expect(demo.center.unreadCount.value).toBe(unread - 1);

    demo.readScene.value = 'error';
    const failed = demo.center.markRead(firstUnread(demo));
    await vi.advanceTimersByTimeAsync(300);
    expect(await failed).toBe(false);
    expect(reasons).toEqual(['消息不存在']);
    expect(demo.center.unreadCount.value).toBe(unread - 1);
  });

  it('收到新消息时排在最前、未读', () => {
    const demo = useMessageDemo({ onReadError: () => undefined });
    const unread = demo.center.unreadCount.value;
    demo.receive();
    expect(demo.center.visible.value[0]?.id).toBe('msg-incoming-1');
    expect(demo.center.unreadCount.value).toBe(unread + 1);
  });
});
