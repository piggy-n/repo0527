// 补的地板（ADR 0170）：扫描采不到的步行表面（玻璃栈道这类），由配准工具沿扫描轨迹算好写进清单，建导航网格时当作三角形加进去
import type { Point3 } from './nav-frame';

/** 一条补的地板：沿 path（局部系里地板上的点）铺一条宽 width 米的带子 */
export interface ScanWalkway {
  readonly path: readonly Point3[];
  readonly width: number;
}

/**
 * 补的地板换成三角形（每 9 个数一个），坐标在导航网格的局部系里：每段一个矩形，两头各伸出半个宽度，拐弯处不留缝；
 * 矩形从这一段起点的高度斜到终点的高度，伸出去的部分和端点一样高。水平长度为 0 的段跳过
 */
export function walkwayTriangles(walkways: readonly ScanWalkway[]): Float32Array {
  const out: number[] = [];
  for (const { path, width } of walkways) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, ay, az] = path[i];
      const [bx, by, bz] = path[i + 1];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) {
        continue;
      }
      // 沿这一段、长半个宽度的向量 (ux, uy)；左手的法向是 (-uy, ux)
      const ux = ((bx - ax) / length) * (width / 2);
      const uy = ((by - ay) / length) * (width / 2);
      const start = [ax - ux, ay - uy];
      const end = [bx + ux, by + uy];
      out.push(start[0] - uy, start[1] + ux, az, start[0] + uy, start[1] - ux, az, end[0] + uy, end[1] - ux, bz);
      out.push(start[0] - uy, start[1] + ux, az, end[0] + uy, end[1] - ux, bz, end[0] - uy, end[1] + ux, bz);
    }
  }
  return Float32Array.from(out);
}
