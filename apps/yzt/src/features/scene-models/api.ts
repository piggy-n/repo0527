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

const common = {
  id: nonEmpty,
  name: nonEmpty,
  cityCode: cityCodeSchema,
  underground: z.boolean(),
  /** 步行的出生点，3D.4 使用 */
  spawn: spawnSchema.optional(),
  /** 预置的漫游路线，3D.4 使用 */
  routes: z.array(routeSchema).optional()
};

// 白膜用 effects（第一种是默认），其他用 tileset；严格对象，两者写错位置时整份清单不合法
const modelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('white'), effects: z.array(effectSchema).nonempty() }),
  z.strictObject({ ...common, kind: z.enum(['oblique', 'indoor']), tileset: nonEmpty })
]);

function duplicate(ids: readonly string[]): string | undefined {
  return ids.find((id, index) => ids.indexOf(id) !== index);
}

// 模型、白膜效果、同一模型的路线各自的 ID 不能重复
function repeatedId(models: readonly z.infer<typeof modelSchema>[]): string | undefined {
  return [
    duplicate(models.map(({ id }) => id)),
    ...models.map(model => (model.kind === 'white' ? duplicate(model.effects.map(({ id }) => id)) : undefined)),
    ...models.map(({ routes = [] }) => duplicate(routes.map(({ id }) => id)))
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
