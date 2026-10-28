// 原型用的 3DT 清单：字段按建议的静态清单格式（名称、所属区划、类型、地下、可步行、预置路线），坐标是示意位置

export type ModelKind = 'oblique' | 'white' | 'indoor';

export interface ModelRoute {
  readonly id: string;
  readonly name: string;
  /** 路线长度，米 */
  readonly length: number;
  /** 途经点 [经度, 纬度] */
  readonly path: readonly (readonly [number, number])[];
}

export interface ModelEffect {
  readonly id: string;
  readonly label: string;
}

export interface ModelEntry {
  readonly id: string;
  readonly name: string;
  readonly cityCode: string;
  readonly cityName: string;
  readonly kind: ModelKind;
  /** 模型在地表以下：漫游时进入地下空间，没有单独的钻地（2026-10-28 的漫游原型） */
  readonly underground: boolean;
  /** 有室内步行用的出生点，可以第一视角漫游 */
  readonly walkable: boolean;
  readonly routes: readonly ModelRoute[];
  /** 白膜的内置效果，每种效果是一套瓦片 */
  readonly effects: readonly ModelEffect[];
  readonly center: readonly [number, number];
  /** 示意的占地边长（米）和高度（米），地下模型的高度是埋深 */
  readonly size: number;
  readonly height: number;
}

export const MODEL_KIND_LABELS: Readonly<Record<ModelKind, string>> = {
  oblique: '倾斜摄影',
  white: '白膜',
  indoor: '室内'
};

const WHITE_EFFECTS: readonly ModelEffect[] = [
  { id: 'plain', label: '无纹理' },
  { id: 'window', label: '内置效果1' },
  { id: 'tech', label: '内置效果2' }
];

// 以中心为原点按米偏移出途经点，示意用，不追求精确
function offsetPath(center: readonly [number, number], offsets: readonly (readonly [number, number])[]) {
  const [lng, lat] = center;
  const metersPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
  return offsets.map(([east, north]) => [lng + east / metersPerLng, lat + north / 110540] as const);
}

const XINJIEKOU: readonly [number, number] = [118.78, 32.04];
const SUZHOU_STATION: readonly [number, number] = [120.666, 31.3176];
const JINJI_LAKE: readonly [number, number] = [120.7, 31.32];
const SLENDER_WEST_LAKE: readonly [number, number] = [119.42, 32.41];
const NANJING_SOUTH: readonly [number, number] = [118.8, 31.97];

export const SAMPLE_MODELS: readonly ModelEntry[] = [
  {
    id: 'nj-xinjiekou',
    name: '新街口商圈倾斜摄影',
    cityCode: '320100',
    cityName: '南京市',
    kind: 'oblique',
    underground: false,
    walkable: false,
    routes: [
      {
        id: 'nj-zhongshan',
        name: '中山路—新街口',
        length: 2600,
        path: offsetPath(XINJIEKOU, [[0, -1300], [60, -400], [0, 0], [-80, 600], [-40, 1300]])
      },
      {
        id: 'nj-hanzhong',
        name: '汉中路沿线',
        length: 1800,
        path: offsetPath(XINJIEKOU, [[-900, -60], [-300, -20], [0, 0], [600, 40], [900, 80]])
      }
    ],
    effects: [],
    center: XINJIEKOU,
    size: 1800,
    height: 260
  },
  {
    id: 'nj-jiangbei',
    name: '江北新区中央商务区白膜',
    cityCode: '320100',
    cityName: '南京市',
    kind: 'white',
    underground: false,
    walkable: false,
    routes: [],
    effects: WHITE_EFFECTS,
    center: [118.72, 32.15],
    size: 2400,
    height: 180
  },
  {
    id: 'nj-south-station',
    name: '南京南站站房',
    cityCode: '320100',
    cityName: '南京市',
    kind: 'indoor',
    underground: false,
    walkable: true,
    routes: [
      {
        id: 'nj-south-entry',
        name: '进站流线',
        length: 420,
        path: offsetPath(NANJING_SOUTH, [[-200, -120], [-60, -100], [0, 0], [120, 60], [200, 140]])
      }
    ],
    effects: [],
    center: NANJING_SOUTH,
    size: 700,
    height: 60
  },
  {
    id: 'sz-station',
    name: '星海广场站',
    cityCode: '320500',
    cityName: '苏州市',
    kind: 'indoor',
    underground: true,
    walkable: true,
    routes: [
      {
        id: 'sz-station-enter',
        name: '进站乘车',
        length: 180,
        path: offsetPath(SUZHOU_STATION, [[-90, -20], [-30, -30], [10, 0], [10, 30], [70, 50]])
      },
      {
        id: 'sz-station-concourse',
        name: '站厅巡览',
        length: 120,
        path: offsetPath(SUZHOU_STATION, [[-110, -10], [-20, 10], [40, 20], [60, 50]])
      },
      {
        id: 'sz-station-platform',
        name: '站台漫步',
        length: 90,
        path: offsetPath(SUZHOU_STATION, [[-20, -10], [30, 0], [70, 10]])
      }
    ],
    effects: [],
    center: SUZHOU_STATION,
    size: 500,
    height: 24
  },
  {
    id: 'sz-old-town',
    name: '古城区白膜',
    cityCode: '320500',
    cityName: '苏州市',
    kind: 'white',
    underground: false,
    walkable: false,
    routes: [],
    effects: WHITE_EFFECTS,
    center: [120.62, 31.31],
    size: 3600,
    height: 80
  },
  {
    id: 'sz-jinji',
    name: '工业园区金鸡湖倾斜摄影',
    cityCode: '320500',
    cityName: '苏州市',
    kind: 'oblique',
    underground: false,
    walkable: false,
    routes: [
      {
        id: 'sz-jinji-loop',
        name: '环金鸡湖',
        length: 7100,
        path: offsetPath(JINJI_LAKE, [
          [-1500, 0],
          [-900, 1300],
          [500, 1500],
          [1500, 300],
          [1100, -1200],
          [-400, -1400],
          [-1500, 0]
        ])
      }
    ],
    effects: [],
    center: JINJI_LAKE,
    size: 3200,
    height: 300
  },
  {
    id: 'wx-taihu',
    name: '太湖新城倾斜摄影',
    cityCode: '320200',
    cityName: '无锡市',
    kind: 'oblique',
    underground: false,
    walkable: false,
    routes: [],
    effects: [],
    center: [120.3, 31.49],
    size: 2600,
    height: 200
  },
  {
    id: 'cz-high-speed',
    name: '高铁新城白膜',
    cityCode: '320400',
    cityName: '常州市',
    kind: 'white',
    underground: false,
    walkable: false,
    routes: [],
    effects: WHITE_EFFECTS,
    center: [119.98, 31.88],
    size: 2000,
    height: 120
  },
  {
    id: 'yz-slender-west-lake',
    name: '瘦西湖景区倾斜摄影',
    cityCode: '321000',
    cityName: '扬州市',
    kind: 'oblique',
    underground: false,
    walkable: false,
    routes: [
      {
        id: 'yz-scenic',
        name: '景区游线',
        length: 3200,
        path: offsetPath(SLENDER_WEST_LAKE, [[-700, -900], [-400, -300], [0, 0], [300, 500], [200, 1000]])
      }
    ],
    effects: [],
    center: SLENDER_WEST_LAKE,
    size: 2200,
    height: 60
  },
  {
    id: 'xz-east-station',
    name: '徐州东站综合枢纽',
    cityCode: '320300',
    cityName: '徐州市',
    kind: 'indoor',
    underground: false,
    walkable: true,
    routes: [],
    effects: [],
    center: [117.28, 34.22],
    size: 900,
    height: 50
  }
];

/** 检查长名称换行与省略的样例 */
export const LONG_NAME_MODEL: ModelEntry = {
  id: 'nj-long-name',
  name: '江苏省自然资源厅机关办公区及周边道路设施精细化实景三维模型（2025 年度更新成果）',
  cityCode: '320100',
  cityName: '南京市',
  kind: 'oblique',
  underground: false,
  walkable: false,
  routes: [],
  effects: [],
  center: [118.76, 32.06],
  size: 900,
  height: 120
};
