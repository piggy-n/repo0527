// 测试用的资源树，结构与 2026-10-11 实测的返回一致（顶层分组 code 为 null、三区三线有 code、空分类、按年份重复的图层记录、
// schema 不声明的 resource 字段、各资源所在的分类）；只取真实数据的一部分

// 接口原样的结构：几何类型不限定，测试可以放进不合法的数据
interface RawLayer {
  code: string;
  name: string;
  geoType: string;
  resource: string;
  yearList: number[];
}

interface RawCategory {
  code: string | null;
  name: string;
  children: (RawCategory | RawLayer)[];
}

function layer(code: string, name: string, geoType: string, yearList: number[], resource: string): RawLayer {
  return { code, name, geoType, resource, yearList };
}

/** /resource-map/base/tree 的 data */
export function resourceTreeData(): RawCategory[] {
  // 后端按年份逐条返回：三年就重复三次，记录完全相同
  const hydl = layer('csxhjctb_hydl', '水域线层', 'Line', [2023, 2024, 2025], '土地资源');
  return [
    {
      code: null,
      name: '基础库',
      children: [
        {
          code: 'tdzy',
          name: '土地资源',
          // 城市国土空间监测的图层也挂在土地资源下
          children: [
            layer('bgdc_cjdcq', '村级调查区', 'Polygon', [2024], '土地资源'),
            layer('bgdc_cjdcqjx', '村级调查区界线', 'Line', [2022], '土地资源'),
            layer('bgdc_dltb', '地类图斑', 'Polygon', [2022], '土地资源'),
            hydl,
            hydl,
            hydl,
            layer('csxhjctb_gyssp', '公用设施点层', 'Point', [2025], '土地资源')
          ]
        },
        { code: null, name: '海洋资源', children: [] },
        { code: 'szy', name: '水资源', children: [layer('szy_kt', '坑塘', 'Polygon', [2025], '水资源')] }
      ]
    },
    // 公共库、主题库下目前都是空分类
    { code: null, name: '公共库', children: [{ code: null, name: '气象', children: [] }] },
    {
      code: 'sqsx',
      name: '三区三线',
      children: [layer('gtkjgh_czkfbj', '城镇开发边界', 'Polygon', [2026], '三区三线')]
    }
  ];
}

/** 完整的响应体 */
export function resourceTreeResponse(data: unknown = resourceTreeData()) {
  return { code: 200, msg: '操作成功', success: true, data };
}
