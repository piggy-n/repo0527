import { z } from 'zod';
import { ToolError } from './errors.ts';

export type Vec3 = readonly [number, number, number];

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

// 只取工具要用的字段，其余字段不管（索引的格式见 LCC2 白皮书）；meshFiles 是碰撞网格，相对索引所在的目录
const indexSchema = z.object({
  epsg: z.number().int(),
  offset: vec3,
  root: z.object({
    meshFiles: z.array(z.string())
  })
});

export type Lcc2Index = z.infer<typeof indexSchema>;

// 一次扫描是 poses，几次扫描拼起来的是 fusionPoses（每次一组），另一个是 null
const poseSchema = z.object({ T: vec3 });
const posesSchema = z.object({
  poses: z.array(poseSchema).nullish(),
  fusionPoses: z.array(z.array(poseSchema)).nullish()
});

const stripBom = (text: string) => text.replace(/^\uFEFF/, '');

/** 读 `.lcc2` 索引；有的导出带 BOM */
export function parseIndex(text: string): Lcc2Index {
  return indexSchema.parse(JSON.parse(stripBom(text)));
}

/** 读 `info/poses.json` 的扫描轨迹，返回 LCC2 局部系里的位置；几次扫描的拼在一起 */
export function parsePoses(text: string): Vec3[] {
  const { poses, fusionPoses } = posesSchema.parse(JSON.parse(stripBom(text)));
  const all = [...(poses ?? []), ...(fusionPoses ?? []).flat()];
  if (all.length === 0) {
    throw new ToolError('poses.json 里没有轨迹点');
  }
  return all.map((pose) => pose.T);
}

/** 沿轨迹取样，相邻两个取样点至少隔 spacing 米：轨迹每 0.1 秒一个点，人走得慢的地方点密，取样后各处的权重相近 */
export function samplePath(points: readonly Vec3[], spacing: number): Vec3[] {
  const samples: Vec3[] = [];
  let last: Vec3 | undefined;
  for (const point of points) {
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) >= spacing) {
      samples.push(point);
      last = point;
    }
  }
  return samples;
}
