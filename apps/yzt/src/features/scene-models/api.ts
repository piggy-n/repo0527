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
  /** 途经点 [经度, 纬度, 椭球高] */
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2)
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
  /** 瓦片集的屏幕误差上限（像素，正数），不写用引擎的默认值 8；显存放不下的模型按模型调大（docs/modules/map-cesium.md） */
  maximumScreenSpaceError: z.number().positive().optional(),
  /** 步行的出生点，3D.4 使用 */
  spawn: spawnSchema.optional(),
  /** 预置的漫游路线，3D.4 使用 */
  routes: z.array(routeSchema).optional()
};

// 白膜用 effects（第一种是默认），倾斜摄影、室内用 tileset，高斯泼溅（ADR 0149）用 lcc2 和 placement；
// 严格对象，写错位置时整份清单不合法。泼溅第一版只显示和拾取，不写出生点、路线和屏幕误差
const modelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('white'), effects: z.array(effectSchema).nonempty() }),
  z.strictObject({ ...common, kind: z.enum(['oblique', 'indoor']), tileset: nonEmpty }),
  z.strictObject({ ...base, kind: z.literal('splat'), lcc2: nonEmpty, placement: placementSchema })
]);

function duplicate(ids: readonly string[]): string | undefined {
  return ids.find((id, index) => ids.indexOf(id) !== index);
}

// 模型、白膜效果、同一模型的路线各自的 ID 不能重复
function repeatedId(models: readonly z.infer<typeof modelSchema>[]): string | undefined {
  return [
    duplicate(models.map(({ id }) => id)),
    ...models.map(model => (model.kind === 'white' ? duplicate(model.effects.map(({ id }) => id)) : undefined)),
    ...models.map(model => (model.kind === 'splat' ? undefined : duplicate((model.routes ?? []).map(({ id }) => id))))
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
