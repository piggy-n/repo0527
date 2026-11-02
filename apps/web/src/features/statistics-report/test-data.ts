// 测试用的记录，结构按联调拿到的 /statistics/page 返回（docs/migration.md）：没有值的键写成 null，每行都带 null 的
// pageNum、pageSize；ID 是超过安全整数的长数字串，状态是中文文字

type RawRecord = Record<string, unknown>;

export function reportRecord(overrides: RawRecord = {}): RawRecord {
  return {
    id: '2117097190761029634',
    year: '2026',
    type: 'baseTable',
    status: '处理成功',
    level: 'province',
    name: '基本统计报表_省级',
    startTime: '2026-11-02 11:31:28',
    finishTime: '2026-11-02 11:39:28',
    createdTime: '2026-11-02 11:31:18',
    pageNum: null,
    pageSize: null,
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
