// 只供浏览器测试使用：在内存里生成的 LCC2（索引加一个 3DGS 的 PLY），写到磁盘上由测试的开发服务器提供
import { commands } from 'vitest/browser';

const SH_C0 = 0.28209479177387814;

export interface SplatSquareOptions {
  /** 边长（米），以 LCC2 局部系的原点为中心，在 z = 0 的平面上 */
  readonly size: number;
  /** 每边的高斯个数 */
  readonly count: number;
  /** 颜色，0～1 */
  readonly color: readonly [number, number, number];
  /** 索引根节点包围盒的顶（米）：真实数据的盒子比高斯大，不写是 0.2（贴着正方形） */
  readonly top?: number;
}

/** 一个铺满正方形的扁平高斯：standard 3DGS 的 PLY（二进制小端，只有基础颜色） */
export function splatSquarePly({ size, count, color }: SplatSquareOptions): ArrayBuffer {
  const properties = [
    'x',
    'y',
    'z',
    'nx',
    'ny',
    'nz',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
    'opacity',
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3'
  ];
  const total = count * count;
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${total}`,
    ...properties.map(name => `property float ${name}`),
    'end_header',
    ''
  ].join('\n');
  const head = new TextEncoder().encode(header);
  const stride = properties.length * 4;
  const buffer = new ArrayBuffer(head.length + total * stride);
  new Uint8Array(buffer).set(head);
  const view = new DataView(buffer, head.length);
  const spacing = size / (count - 1);
  // 相邻的高斯重叠一些，铺成一整块；z 方向很薄
  const radius = Math.log(spacing * 0.75);
  const dc = color.map(value => (value - 0.5) / SH_C0);
  for (let i = 0; i < total; i++) {
    const x = (i % count) * spacing - size / 2;
    const y = Math.floor(i / count) * spacing - size / 2;
    const values = [x, y, 0, 0, 0, 0, ...dc, 6, radius, radius, Math.log(0.05), 1, 0, 0, 0];
    values.forEach((value, index) => view.setFloat32(i * stride + index * 4, value, true));
  }
  return buffer;
}

/**
 * LCC2 的索引（一级、一个节点、一个 PLY），开头带 BOM，和真实数据一样；
 * 数据文件的路径相对索引，层级同楚王山1号（data/3dgs/）
 */
export function splatSquareIndex({ size, count, top = 0.2 }: Omit<SplatSquareOptions, 'color'>): ArrayBuffer {
  const half = size / 2;
  const boundingBox = { min: [-half, -half, -0.2], max: [half, half, top] };
  const index = {
    version: '0.0.3',
    name: 'fixture',
    epsg: 4548,
    offset: [0, 0, 0],
    shift: [0, 0, 0],
    scale: [1, 1, 1],
    fileType: 'portable',
    totalSplats: count * count,
    lodSplats: [count * count],
    totalLevels: 1,
    splatType: '.ply',
    root: {
      id: '0',
      boundingBox,
      childNum: 1,
      splatFiles: ['data/3dgs/0.ply'],
      child: { '0': { id: '0_0', boundingBox, data: { '3dgs': { name: 0, start: 0, count: count * count } } } }
    }
  };
  return new TextEncoder().encode(`﻿${JSON.stringify(index)}`).buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(text);
}

// 库在自己的 Worker 里下载数据块，拦不到页面的 fetch：写到包里不入库的目录，由测试的开发服务器提供（支持 Range）
const FIXTURE_DIRECTORY = 'node_modules/.tmp/splat-fixtures';

/**
 * 把正方形的 LCC2 写到磁盘上，给出索引的绝对地址；目录名有中文，地址按 URL 编码（同楚王山1号）。
 * 返回的 cleanup 删掉写下的文件
 */
export async function writeSplatSquare(
  name: string,
  options: SplatSquareOptions
): Promise<{ readonly url: string; readonly cleanup: () => Promise<void> }> {
  const directory = `${FIXTURE_DIRECTORY}/${name}`;
  const files = {
    [`${directory}/${name}.lcc2`]: splatSquareIndex(options),
    [`${directory}/data/3dgs/0.ply`]: splatSquarePly(options)
  };
  await Promise.all(Object.entries(files).map(([path, data]) => commands.writeFile(path, toBase64(data), 'base64')));
  const url = new URL(`/${directory}/${name}.lcc2`.split('/').map(encodeURIComponent).join('/'), window.location.origin).href;
  return {
    url,
    cleanup: async () => {
      await Promise.all(Object.keys(files).map(path => commands.removeFile(path)));
    }
  };
}
