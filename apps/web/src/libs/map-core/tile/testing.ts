import { PbfWriter } from 'pbf';
import type { TileProperty } from './mvt-decode';

/** 小型本地 MVT 样本，使用 PBF 库编码以覆盖真实的解析链路 */
export interface TestTileFeature {
  readonly id?: number;
  readonly type: number;
  readonly properties?: Readonly<Record<string, TileProperty>>;
  readonly paths: readonly (readonly (readonly [number, number])[])[];
}

interface TestTileLayer {
  readonly name: string;
  readonly extent?: number;
  readonly features: readonly TestTileFeature[];
}

/** 只用于测试的合法 MVT 编码，不读取网络或业务数据 */
export function tileBytes(layers: readonly TestTileLayer[]): ArrayBuffer {
  const tile = new PbfWriter();
  for (const layer of layers) {
    tile.writeMessage(3, (current, writer) => {
      writer.writeVarintField(15, 2);
      writer.writeStringField(1, current.name);
      writer.writeVarintField(5, current.extent ?? 4096);
      const keys: string[] = [];
      const values: TileProperty[] = [];
      for (const feature of current.features) {
        writer.writeMessage(2, (entry, featureWriter) => {
          if (entry.id !== undefined) {
            featureWriter.writeVarintField(1, entry.id);
          }
          const tags: number[] = [];
          for (const [key, value] of Object.entries(entry.properties ?? {})) {
            const keyIndex = keys.indexOf(key);
            tags.push(keyIndex < 0 ? keys.push(key) - 1 : keyIndex, values.push(value) - 1);
          }
          featureWriter.writePackedVarint(2, tags);
          featureWriter.writeVarintField(3, entry.type);
          featureWriter.writeMessage(4, (item, geometryWriter) => {
            let x = 0;
            let y = 0;
            for (const path of item.paths) {
              const closed = item.type === 3 && path.length > 1 &&
                path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1];
              const points = closed ? path.slice(0, -1) : path;
              if (!points.length) {
                continue;
              }
              for (let point = 0; point < points.length; point++) {
                if (point === 0 || item.type === 1) {
                  geometryWriter.writeVarint(9);
                } else if (point === 1) {
                  geometryWriter.writeVarint((points.length - 1) * 8 + 2);
                }
                geometryWriter.writeSVarint(points[point][0] - x);
                geometryWriter.writeSVarint(points[point][1] - y);
                [x, y] = points[point];
              }
              if (item.type === 3) {
                geometryWriter.writeVarint(15);
              }
            }
          }, entry);
        }, feature);
      }
      for (const key of keys) {
        writer.writeStringField(3, key);
      }
      for (const value of values) {
        writer.writeMessage(4, (item, valueWriter) => {
          if (typeof item === 'string') {
            valueWriter.writeStringField(1, item);
          } else if (typeof item === 'boolean') {
            valueWriter.writeBooleanField(7, item);
          } else {
            valueWriter.writeDoubleField(3, item);
          }
        }, value);
      }
    }, layer);
  }
  return new Uint8Array(tile.finish()).buffer;
}

/** 可显式放行的异步边界，测试取消不依赖固定时长 */
export function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(open => { resolve = open; });
  return { promise, resolve };
}

export function sampleTile(): ArrayBuffer {
  return tileBytes([{
    name: '地块',
    features: [{ id: 7, type: 1, properties: { class: '林地', name: '样本', enabled: true }, paths: [[[1024, 2048]]] }]
  }]);
}
