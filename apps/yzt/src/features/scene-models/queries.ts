import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';
import { fetchSceneManifest, type SceneManifest, sceneManifestUrl } from './api';
import { buildModelCatalog } from './catalog';

/** 三维模型的 query key 只在这里拼 */
export const sceneModelKeys = {
  all: ['scene-models'] as const,
  manifest: () => [...sceneModelKeys.all, 'manifest'] as const
};

const selectCatalog = (manifest: SceneManifest) => buildModelCatalog(manifest, sceneManifestUrl());

/** 3DT 清单（ADR 0081 第 1 节）：查询缓存保存清单，`select` 由它得出目录；enabled 为 false 时不请求（二维用不到） */
export function useSceneModelsQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: sceneModelKeys.manifest(),
    queryFn: ({ signal }) => fetchSceneManifest(signal),
    select: selectCatalog,
    enabled,
    // 部署时放好的静态文件，页面打开期间不变：每次切到三维不重新请求，失败后由面板的重试再读
    staleTime: Infinity
  });
}
