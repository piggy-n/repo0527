// 测试用的接口返回，结构与 2026-10-08 实测一致（含 schema 未声明、解析时会被丢弃的字段），文件名、人名是虚构的

export function fileRecordResponse(index: number, categoryId = 'technical-standard-current-survey') {
  return {
    bucket: null,
    categoryId,
    createdId: 'user-1',
    createdName: 'admin',
    createdTime: '2026-08-04 15:18:23',
    id: `file-${categoryId}-${index}`,
    name: `测试文件${index}.pdf`,
    objectKey: `object-${index}`,
    remark: index % 2 === 0 ? null : '备注',
    size: 1024 * index,
    tag: '综合',
    type: 'pdf',
    year: '2026'
  };
}

/** /file/page 的完整响应体 */
export function filePageResponse({
  categoryId = 'technical-standard-current-survey',
  pageNo = 1,
  pageSize = 20,
  totalElements = 0
}: { categoryId?: string; pageNo?: number; pageSize?: number; totalElements?: number }) {
  const totalPages = Math.ceil(totalElements / pageSize);
  // 越界时后端返回最后一页的数据，但 pageNo 原样返回
  const effectivePage = Math.min(Math.max(pageNo, 1), Math.max(totalPages, 1));
  const start = (effectivePage - 1) * pageSize;
  const count = Math.max(Math.min(pageSize, totalElements - start), 0);
  return {
    code: 200,
    msg: '请求成功',
    success: true,
    data: {
      content: Array.from({ length: count }, (_, i) => fileRecordResponse(start + i + 1, categoryId)),
      currentPageNum: pageNo,
      hasNextPage: effectivePage < totalPages,
      hasPreviousPage: effectivePage > 1,
      nextPageNum: Math.min(effectivePage + 1, Math.max(totalPages, 1)),
      pageNo,
      pageSize,
      prePageNum: Math.max(pageNo - 1, 1),
      totalElements,
      totalPages
    }
  };
}
