import { EYE_HEIGHT } from '@mx/map-core';
import { z } from 'zod';
import { http } from '@/shared/http/client';
import { findRegion } from '@/shared/map/region/region-catalog';

// 3DT 清单（ADR 0081 第 1 节）：部署目录里的静态文件，模型的地址相对清单

const nonEmpty = z.string().min(1);

const spawnSchema = z.strictObject({
  lng: z.number(),
  lat: z.number(),
  /** 椭球高，米 */
  height: z.number(),
  /** 朝向，度，正北为 0、顺时针 */
  heading: z.number()
});

const routeSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  /** 途经点 [经度, 纬度, 椭球高]；矮的地方多一个眼高（视点在地板以上的米数，ADR 0156 第 3 节） */
  path: z
    .array(
      z.union([
        z.tuple([z.number(), z.number(), z.number()]),
        z.tuple([z.number(), z.number(), z.number(), z.number().positive().max(EYE_HEIGHT)])
      ])
    )
    .min(2)
});

const effectSchema = z.strictObject({ id: nonEmpty, label: nonEmpty, tileset: nonEmpty });

// 市代码必须在区划目录里，市名取自目录（清单不写名称）
const cityCodeSchema = z.string().refine(code => findRegion(code)?.level === 'city', { message: '不是区划目录里的市' });

const base = {
  id: nonEmpty,
  name: nonEmpty,
  cityCode: cityCodeSchema,
  underground: z.boolean()
};

// LCC2 的摆放（ADR 0149 第 3 节）：配准后的最终值，运行时不按数据带的 epsg、offset 换算
const placementSchema = z.strictObject({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  /** 原点的椭球高，米 */
  height: z.number(),
  /** 局部 x 轴（网格东）从正东逆时针转的角度，度，包括子午线收敛角 */
  heading: z.number()
});

// 瓦片集模型（白膜、倾斜摄影、室内）共有的
const common = {
  ...base,
  /** 瓦片集的屏幕误差上限（像素，正数），不写用引擎的默认值 8；显存放不下的模型按模型调大（docs/config/3dt-manifest.md） */
  maximumScreenSpaceError: z.number().positive().optional(),
  /** 步行的出生点，3D.4 使用 */
  spawn: spawnSchema.optional(),
  /** 预置的漫游路线，3D.4 使用 */
  routes: z.array(routeSchema).optional()
};

// 白膜用 effects（第一种是默认），倾斜摄影、室内用 tileset，高斯泼溅（ADR 0149）用 lcc2 和 placement；
// 严格对象，写错位置时整份清单不合法。泼溅不写屏幕误差；出生点、路线由配准工具从扫描轨迹生成（ADR 0156 第 4 节）
const modelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('white'), effects: z.array(effectSchema).nonempty() }),
  z.strictObject({ ...common, kind: z.enum(['oblique', 'indoor']), tileset: nonEmpty }),
  z.strictObject({
    ...base,
    kind: z.literal('splat'),
    lcc2: nonEmpty,
    placement: placementSchema,
    spawn: spawnSchema.optional(),
    routes: z.array(routeSchema).optional()
  })
]);

function duplicate(ids: readonly string[]): string | undefined {
  return ids.find((id, index) => ids.indexOf(id) !== index);
}

// 模型、白膜效果、同一模型的路线各自的 ID 不能重复
function repeatedId(models: readonly z.infer<typeof modelSchema>[]): string | undefined {
  return [
    duplicate(models.map(({ id }) => id)),
    ...models.map(model => (model.kind === 'white' ? duplicate(model.effects.map(({ id }) => id)) : undefined)),
    ...models.map(model => duplicate((model.routes ?? []).map(({ id }) => id)))
  ].find(id => id !== undefined);
}

const manifestShape = z.strictObject({ models: z.array(modelSchema) });

export const sceneManifestSchema = manifestShape.superRefine(({ models }, context) => {
  const repeated = repeatedId(models);
  if (repeated !== undefined) {
    context.addIssue({ code: 'custom', message: `ID 重复：${repeated}` });
  }
});

export type SceneManifest = z.infer<typeof sceneManifestSchema>;
export type ManifestModel = SceneManifest['models'][number];

/** 清单的绝对地址：部署在 `${BASE_URL}3dt/` 下 */
export function sceneManifestUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}3dt/manifest.json`, window.location.href).href;
}

/** 读清单；不经过 /backend、没有信封；失败由模型面板显示并重试，不弹全局提示 */
export function fetchSceneManifest(signal?: AbortSignal) {
  return http.get(sceneManifestUrl(), { schema: sceneManifestSchema, envelope: false, signal, silent: true });
}

/** 读瓦片集的索引（tileset.json）：内容由 map-core 的 prepareTileset 校验整理；失败由步行操作条显示 */
export function fetchTilesetJson(url: string, signal: AbortSignal) {
  return http.get(url, { schema: z.unknown(), envelope: false, signal, silent: true });
}

// LCC2 索引（.lcc2，ADR 0156 第 2 节）只取碰撞网格那部分：节点的包围盒（LCC2 的局部系），带网格的节点在 data.mesh
// 里写着根节点 meshFiles 的序号和面数；其余字段（泼溅的分块、LOD）由 map-three 的库读
const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

interface Lcc2Node {
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  data?: { mesh?: { name: number; face: number } };
  child?: Record<string, Lcc2Node>;
}

const meshRefSchema = z.object({ name: z.number().int().nonnegative(), face: z.number().int().nonnegative() });

const lcc2NodeSchema: z.ZodType<Lcc2Node> = z.lazy(() =>
  z.object({
    boundingBox: z.object({ min: vec3Schema, max: vec3Schema }),
    data: z.object({ mesh: meshRefSchema.optional() }).optional(),
    child: z.record(z.string(), lcc2NodeSchema).optional()
  })
);

// 有的导出开头带 BOM（ADR 0149 第 3 节）：浏览器按 UTF-8 解码响应时已经去掉，这里不用再处理（测试里有带 BOM 的）
const lcc2IndexSchema = z.object({
  root: z.object({ meshFiles: z.array(nonEmpty).optional() }).and(lcc2NodeSchema)
});

export type Lcc2Index = z.infer<typeof lcc2IndexSchema>;

/** 读 LCC2 的索引（碰撞网格那部分）；失败由步行操作条显示 */
export function fetchLcc2Index(url: string, signal: AbortSignal) {
  return http.get(url, { schema: lcc2IndexSchema, envelope: false, signal, silent: true });
}
