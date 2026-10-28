// 测试用的虚构记录，字段结构按 2026-10-27 实测接口（docs/migration.md）：没有值的字段整个键都不出现

type RawRecord = Record<string, unknown>;

/** 待审核的申请：实测没有申请人和准备状态 */
export function pendingRecord(overrides: RawRecord = {}): RawRecord {
  return {
    apply_id: 'apply-pending',
    apply_name: '拆除未尽区',
    apply_purpose: '城市更新专项核查',
    create_time: '2026-10-28T03:29:36.527+00:00',
    data_formats: 'gdb',
    end_date: '2026-11-27T12:29:18.000+00:00',
    layer_code: 'bgdc_dltb_2022',
    receiver_dept_code: 'jsdxzx',
    receiver_dept_name: '江苏省基础地理信息中心',
    start_date: '2026-10-27T12:29:18.000+00:00',
    status: 'pending',
    xzqdm: '320100',
    xzqmc: '江苏省南京市',
    ...overrides
  };
}

/** 审核通过、已经开始准备数据的申请 */
export function approvedRecord(overrides: RawRecord = {}): RawRecord {
  return {
    apply_id: 'apply-approved',
    apply_name: '城镇村等用地',
    apply_purpose: '业务',
    create_time: '2026-09-10T08:47:07.714+00:00',
    data_formats: 'excel,shp',
    end_date: '2026-09-10T08:46:56.000+00:00',
    file_path: '',
    layer_code: 'bgdc_czcdyd_2022',
    receiver_dept_code: 'jsdxzx',
    receiver_dept_name: '江苏省基础地理信息中心',
    remark: '',
    start_date: '2026-09-10T08:46:56.000+00:00',
    status: 'approved',
    storage_progess: 100,
    storage_status: 'timeout',
    storage_task_name: '城镇村等用地',
    user_id: 'user-1',
    user_name: '王立',
    xzqdm: '320000',
    xzqmc: '江苏省',
    ...overrides
  };
}

/** 混在申请表里的统计任务：真实数据里有一条连名称和时间都没有 */
export function tableRecord(overrides: RawRecord = {}): RawRecord {
  return {
    apply_id: 'table-1',
    data_formats: '.zip',
    end_date: '2026-06-29T00:17:28.400+00:00',
    receiver_dept_code: 'jsdxzx',
    receiver_dept_name: '江苏省基础地理信息中心',
    start_date: '2026-06-29T00:17:28.400+00:00',
    status: 'table',
    user_name: '王立',
    ...overrides
  };
}

/** 成功的信封 */
export function envelope(data: unknown) {
  return { success: true, code: 200, msg: '请求成功', data };
}

/** PageHelper 的一页，带上界面用不到的分页字段 */
export function applicationPageResponse(list: RawRecord[], { total = list.length, pageNum = 1, pageSize = 20 } = {}) {
  return envelope({
    total,
    list,
    pageNum,
    pageSize,
    size: list.length,
    pages: Math.ceil(total / pageSize),
    isFirstPage: pageNum === 1,
    navigatepageNums: [1]
  });
}
