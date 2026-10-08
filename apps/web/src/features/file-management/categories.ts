// 文件分类和业务类型标签是前端写死的业务配置，从旧项目 src/mock/file-management-data.js 迁移（不是 mockjs 假数据）

/** 分类树的节点：有 children 的是分组，叶子节点的 id 就是后端的 categoryId */
export interface FileCategory {
  id: string;
  label: string;
  children?: readonly FileCategory[];
}

export const fileCategories: readonly FileCategory[] = [
  {
    id: 'technical-standard',
    label: '技术标准规范',
    children: [
      {
        id: 'technical-standard-current',
        label: '国家/行业现行技术规程、标准、规范',
        children: [
          { id: 'technical-standard-current-survey', label: '自然资源调查类' },
          { id: 'technical-standard-current-monitor', label: '监测类' },
          { id: 'technical-standard-current-database', label: '数据库类' },
          { id: 'technical-standard-current-other', label: '其他' }
        ]
      },
      {
        id: 'technical-standard-local',
        label: '地方补充技术规定/细则',
        children: [
          { id: 'technical-standard-local-survey', label: '自然资源调查类' },
          { id: 'technical-standard-local-monitor', label: '监测类' },
          { id: 'technical-standard-local-database', label: '数据库类' },
          { id: 'technical-standard-local-other', label: '其他' }
        ]
      }
    ]
  },
  {
    id: 'design-report',
    label: '设计与报告',
    children: [
      {
        id: 'design-report-summary',
        label: '设计、总结（含工作总结）',
        children: [
          { id: 'design-report-project-design', label: '项目（技术）设计类' },
          { id: 'design-report-project-summary', label: '项目（技术）总结类' },
          { id: 'design-report-special-report', label: '专题报告' }
        ]
      }
    ]
  },
  {
    id: 'policy-law',
    label: '政策法规',
    children: [
      { id: 'policy-law-national', label: '国家层面政策法规' },
      { id: 'policy-law-local', label: '地方层面政策法规' }
    ]
  },
  {
    id: 'government-document',
    label: '政务公文',
    children: [
      { id: 'government-document-notice', label: '通知' },
      { id: 'government-document-bulletin', label: '公报' }
    ]
  }
];

export const DEFAULT_CATEGORY_ID = 'technical-standard-current-survey';

/** 从根到该分类的标签，例如 ['技术标准规范', '国家/行业现行技术规程、标准、规范', '监测类']；找不到时返回空数组 */
export function findCategoryPath(id: string, nodes: readonly FileCategory[] = fileCategories): string[] {
  for (const node of nodes) {
    if (node.id === id) {
      return [node.label];
    }
    const rest = node.children ? findCategoryPath(id, node.children) : [];
    if (rest.length > 0) {
      return [node.label, ...rest];
    }
  }
  return [];
}

/** 业务类型标签，筛选和上传共用；接口返回的 tag 是普通字符串，不保证在这份清单里 */
export const fileTags = [
  '综合',
  '土地（耕地）',
  '矿产',
  '海洋',
  '水',
  '森林',
  '草原',
  '湿地',
  '荒漠',
  '国家公园',
  '其他'
] as const;
