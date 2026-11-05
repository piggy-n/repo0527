import type { AiSession } from './api';

export type HistoryGroupLabel = '今天' | '昨天' | '更早';

export interface HistorySection {
  readonly label: HistoryGroupLabel;
  readonly sessions: readonly AiSession[];
}

const DAY_MS = 86_400_000;
const GROUP_LABELS: readonly HistoryGroupLabel[] = ['今天', '昨天', '更早'];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseTime(text: string): Date | null {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 按本地日期分组；时间解析不了的归入"更早" */
export function historyGroup(time: string, now: Date): HistoryGroupLabel {
  const date = parseTime(time);
  if (!date) {
    return '更早';
  }
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) {
    return '今天';
  }
  return days === 1 ? '昨天' : '更早';
}

export function sessionTitle(session: AiSession): string {
  return session.title?.trim() || '未命名对话';
}

/** 按标题搜索（不区分大小写）后按日期分组，保留后端给的顺序，空的分组不返回 */
export function historySections(sessions: readonly AiSession[], keyword: string, now: Date): HistorySection[] {
  const query = keyword.trim().toLowerCase();
  const matched = query === '' ? sessions : sessions.filter(s => sessionTitle(s).toLowerCase().includes(query));
  return GROUP_LABELS.map(label => ({
    label,
    sessions: matched.filter(session => historyGroup(session.last_time, now) === label)
  })).filter(section => section.sessions.length > 0);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 今天只显示时间，昨天加"昨天"，更早加月日 */
export function historyTime(time: string, now: Date): string {
  const date = parseTime(time);
  if (!date) {
    return '';
  }
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const group = historyGroup(time, now);
  if (group === '今天') {
    return clock;
  }
  return group === '昨天' ? `昨天 ${clock}` : `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${clock}`;
}
