// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AiSession } from './api';
import { historyGroup, historySections, historyTime, sessionTitle } from './history';

// 本地时间 2026-10-28 09:30
const now = new Date(2026, 9, 28, 9, 30);
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

const session = (id: string, title: string | null, lastTime: string): AiSession => ({
  session_id: id,
  title,
  message_count: 2,
  last_time: lastTime
});

describe('historyGroup', () => {
  it('按本地日期分今天、昨天、更早，解析不了的归入更早', () => {
    expect(historyGroup(local(28, 0, 5), now)).toBe('今天');
    expect(historyGroup(local(27, 23, 59), now)).toBe('昨天');
    expect(historyGroup(local(26, 12), now)).toBe('更早');
    expect(historyGroup('不是时间', now)).toBe('更早');
  });
});

describe('historyTime', () => {
  it('今天只显示时间，昨天加"昨天"，更早加月日', () => {
    expect(historyTime(local(28, 8, 3), now)).toBe('08:03');
    expect(historyTime(local(27, 18, 30), now)).toBe('昨天 18:30');
    expect(historyTime(local(3, 7, 0), now)).toBe('10/03 07:00');
    expect(historyTime('', now)).toBe('');
  });
});

describe('historySections', () => {
  const sessions = [
    session('a', '南京市耕地面积', local(28, 9)),
    session('b', null, local(28, 8)),
    session('c', 'Nanjing 边界', local(20, 9))
  ];

  it('保留后端的顺序分组，空的分组不返回', () => {
    expect(historySections(sessions, '', now).map(({ label, sessions: items }) => [label, items.length])).toEqual([
      ['今天', 2],
      ['更早', 1]
    ]);
  });

  it('按标题搜索，不区分大小写，没有标题的按"未命名对话"', () => {
    expect(historySections(sessions, ' nanjing ', now)[0]?.sessions.map(item => item.session_id)).toEqual(['c']);
    expect(historySections(sessions, '未命名', now)[0]?.sessions.map(item => item.session_id)).toEqual(['b']);
    expect(historySections(sessions, '武汉', now)).toEqual([]);
  });

  it('空白标题显示为未命名对话', () => {
    expect(sessionTitle(session('d', '  ', local(28, 9)))).toBe('未命名对话');
  });
});
