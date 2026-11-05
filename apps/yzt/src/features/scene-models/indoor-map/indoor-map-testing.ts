// 只供测试使用：手工拼的两层小车站和它的局部系
import { type Navigation, NavGrid, navigationFrame } from '@yzt/map-core';

const CHUNK = 32;
const LEVELS = 4;
const EMPTY = -32768;
// 1 米 = 50 个 2 厘米；最低位是"头顶有遮盖"
const encode = (z: number) => (Math.round(z * 50) * 2) | 1;

/**
 * 38.4 × 12.8 米（192 × 64 格）：西半边（x < 19.2）地板在 -5 米，东半边在 -10 米，都有 3 米高的顶板，各是一个区域。
 * north 是局部 y 轴的方位角（度），原点在苏州站附近的地面上
 */
export function twoLevelNavigation(north = 0): Navigation {
  const width = 192;
  const height = 64;
  const chunksX = width / CHUNK;
  const chunksY = height / CHUNK;
  const blockSize = CHUNK * CHUNK * LEVELS;
  const blocks = chunksX * chunksY;
  const data = new Int16Array(blocks * blockSize).fill(EMPTY);
  const headroom = new Uint8Array(blocks * blockSize).fill(255);
  const labels = new Uint16Array(blocks * blockSize);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const block = Math.floor(cy / CHUNK) * chunksX + Math.floor(cx / CHUNK);
      const index = block * blockSize + ((cy % CHUNK) * CHUNK + (cx % CHUNK)) * LEVELS;
      const west = cx < width / 2;
      data[index] = encode(west ? -5 : -10);
      headroom[index] = 30;
      labels[index] = west ? 1 : 2;
    }
  }
  const half = (width / 2) * height;
  const grid = new NavGrid({
    meta: {
      minX: 0,
      minY: 0,
      cellSize: 0.2,
      width,
      height,
      chunksX,
      chunksY,
      maxLevels: LEVELS,
      floorCells: width * height,
      droppedLevels: 0
    },
    chunkIndex: Int32Array.from({ length: blocks }, (_, index) => index),
    data,
    headroom,
    labels,
    sizes: Uint32Array.of(0, half, half)
  });
  return { grid, frame: navigationFrame(enuFrame(120.6647, 31.3175, north)) };
}

// 原点处的东北天，再绕天顶转到局部 y 轴的方位角是 north
function enuFrame(lng: number, lat: number, north: number): number[] {
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const theta = (north * Math.PI) / 180;
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const northAxis = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const yAxis = northAxis.map((value, i) => value * Math.cos(theta) + east[i] * Math.sin(theta));
  const xAxis = east.map((value, i) => value * Math.cos(theta) - northAxis[i] * Math.sin(theta));
  // WGS84 椭球面上的点
  const radius = 6378137 / Math.sqrt(1 - 6.69437999014e-3 * Math.sin(phi) ** 2);
  const origin = [
    radius * Math.cos(phi) * Math.cos(lambda),
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * (1 - 6.69437999014e-3) * Math.sin(phi)
  ];
  return [...xAxis, 0, ...yAxis, 0, ...up, 0, ...origin, 1];
}
