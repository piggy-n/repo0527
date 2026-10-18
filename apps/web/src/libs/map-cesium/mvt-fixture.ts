import { PbfWriter } from 'pbf';

type Coordinate = readonly [number, number];

interface SampleFeature {
  readonly id: number;
  readonly type: 1 | 2 | 3;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly paths: readonly (readonly Coordinate[])[];
}

interface SampleLayer {
  readonly name: string;
  readonly extent: number;
  readonly features: readonly SampleFeature[];
}

// 仅供测试：合成数据含不同 extent、孔洞、分类、稳定身份和越过瓦片边界的线
const LAYERS: readonly SampleLayer[] = [
  {
    name: 'landuse', extent: 4096,
    features: [
      {
        id: 11, type: 3, properties: { category: 'primary', bsm: 'area-primary', enabled: true, rank: 7 },
        paths: [
          [[256, 256], [3072, 256], [3072, 3584], [256, 3584]],
          [[1280, 1280], [1280, 2560], [2304, 2560], [2304, 1280]]
        ]
      },
      {
        id: 12, type: 3, properties: { category: 'secondary', bsm: 'area-secondary' },
        paths: [[[3328, 512], [3968, 512], [3968, 3200], [3328, 3200]]]
      }
    ]
  },
  {
    name: 'detail', extent: 8192,
    features: [
      {
        id: 21, type: 2, properties: { category: 'primary', guid: 'path-primary' },
        paths: [[[1024, 6144], [4096, 2048], [7168, 6144]]]
      },
      {
        id: 22, type: 1, properties: { category: 'secondary', guid: 'points-secondary' },
        paths: [[[2048, 4096], [6144, 4096]]]
      },
      {
        id: 23, type: 2, properties: { category: 'boundary', guid: 'path-buffer' },
        paths: [[[-1024, 4096], [9216, 4096]]]
      }
    ]
  }
];

/** 生成完全本地的 MVT 二进制，每次调用都返回独立缓冲区 */
export function createMvtFixture(): Uint8Array<ArrayBuffer> {
  const writer = new PbfWriter();
  for (const layer of LAYERS) {
    writer.writeMessage(3, writeLayer, layer);
  }
  return Uint8Array.from(writer.finish());
}

/** 真实浏览器和 Worker 可直接 fetch 的合成瓦片地址 */
export function mvtFixtureUrl(): string {
  return `data:application/vnd.mapbox-vector-tile;base64,${btoa(String.fromCharCode(...createMvtFixture()))}`;
}

function writeLayer(layer: SampleLayer, writer: PbfWriter): void {
  const keys = [...new Set(layer.features.flatMap(feature => Object.keys(feature.properties)))];
  const values = [...new Set(layer.features.flatMap(feature => Object.values(feature.properties)))];
  writer.writeVarintField(15, 2);
  writer.writeStringField(1, layer.name);
  for (const feature of layer.features) {
    writer.writeMessage(2, (value, output) => {
      output.writeVarintField(1, value.id);
      output.writePackedVarint(2, Object.entries(value.properties).flatMap(([key, property]) => [
        keys.indexOf(key), values.indexOf(property)
      ]));
      output.writeVarintField(3, value.type);
      output.writePackedVarint(4, geometryCommands(value));
    }, feature);
  }
  keys.forEach(key => writer.writeStringField(3, key));
  values.forEach(value => writer.writeMessage(4, (property, output) => {
    if (typeof property === 'string') {
      output.writeStringField(1, property);
    } else if (typeof property === 'boolean') {
      output.writeBooleanField(7, property);
    } else {
      output.writeDoubleField(3, property);
    }
  }, value));
  writer.writeVarintField(5, layer.extent);
}

// MVT 几何用相对坐标与命令长度编码，环闭合交给 ClosePath 命令
function geometryCommands(feature: SampleFeature): number[] {
  const commands: number[] = [];
  let x = 0;
  let y = 0;
  const append = ([nextX, nextY]: Coordinate) => {
    const dx = nextX - x;
    const dy = nextY - y;
    commands.push(dx < 0 ? -2 * dx - 1 : 2 * dx, dy < 0 ? -2 * dy - 1 : 2 * dy);
    x = nextX;
    y = nextY;
  };
  for (const path of feature.paths) {
    if (feature.type === 1) {
      commands.push(path.length * 8 + 1);
      path.forEach(append);
      continue;
    }
    commands.push(9);
    append(path[0]);
    commands.push((path.length - 1) * 8 + 2);
    path.slice(1).forEach(append);
    if (feature.type === 3) {
      commands.push(15);
    }
  }
  return commands;
}
