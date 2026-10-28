// 测试用的虚构记录。2026-10-27 实测 /statistics/page 没有记录，字段按旧页面读的写（见 api.ts），待联调核对

type RawRecord = Record<string, unknown>;

export function reportRecord(overrides: RawRecord = {}): RawRecord {
  return {
    id: 'report-1',
    name: '基本统计报表_省级',
    year: 2024,
    startTime: '2026-10-14 14:20:00',
    finishTime: '2026-10-14 14:23:45',
    status: 'success',
    ...overrides
  };
}

/** PageHelper 的一页 */
export function reportPageResponse(list: RawRecord[], { total = list.length, pageNum = 1, pageSize = 20 } = {}) {
  return {
    success: true,
    code: 200,
    msg: '请求成功',
    data: { total, list, pageNum, pageSize, pages: Math.ceil(total / pageSize) }
  };
}
