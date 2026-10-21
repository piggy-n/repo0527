// 测试用的虚构记录，字段结构按 2026-10-21 实测接口；不携带真实用户或业务主键

export function resourceDirectoryResponse() {
  return {
    success: true,
    code: 200,
    msg: '请求成功',
    data: [
      { id: 'base', name: '基础库', code: null, parentId: null, icon: null, iconSelected: null, children: [
        { id: 'land', name: '土地资源', code: 'tdzy', parentId: 'base', icon: '土地资源@1x.png',
          iconSelected: '土地资源1@1x.png', children: null },
        { id: 'water', name: '水资源', code: 'szy', parentId: 'base', icon: null, iconSelected: null, children: null }
      ] },
      { id: 'public', name: '公共库', parentId: null, children: [
        { id: 'weather', name: '气象', parentId: 'public', children: null }
      ] },
      { id: 'three', name: '三区三线', parentId: null, children: null }
    ]
  };
}

export function resourceYearsResponse() {
  return { code: 200, data: [
    { label: '2025', value: '2025', sort: null },
    { label: '2024', value: '2024', sort: null },
    { label: '2023', value: '2023', sort: null }
  ] };
}

export function resourceRecordResponse(index: number, resource = '土地资源') {
  return {
    id: `${resource}-${index}`,
    layer_name: `${resource}记录${index}`,
    year: 2025,
    dataset_name: '年度调查数据集',
    resource_name: resource,
    layer_code: `LAYER_${index}`,
    dataset_code: 'DATASET',
    slice: index % 2 === 0,
    enable: index % 3 === 0 ? 'false' : 'true',
    geo_type: 'Polygon'
  };
}

/** 与 PageHelper 一致：越界返回修正后的 pageNum，空列表 pages=0 */
export function resourcePageResponse({ resource = '土地资源', pageNum = 1, pageSize = 10, total = 24 }: {
  resource?: string;
  pageNum?: number;
  pageSize?: number;
  total?: number;
} = {}) {
  const pages = Math.ceil(total / pageSize);
  const effectivePage = Math.min(Math.max(pageNum, 1), Math.max(pages, 1));
  const start = (effectivePage - 1) * pageSize;
  return {
    success: true,
    code: 200,
    msg: '请求成功',
    data: {
      total,
      list: Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) =>
        resourceRecordResponse(start + index + 1, resource)),
      pageNum: effectivePage,
      pageSize,
      pages,
      navigatePages: 8
    }
  };
}
