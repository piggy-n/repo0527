import { z } from 'zod';
import type { SceneModel } from './catalog';

/**
 * 记下的三维模型（ADR 0167）：加入的模型（图层里的先后，最上面的在前）、隐藏的、白膜换过的效果。
 * 除了类型，还要自洽：加入的不重复，隐藏的、换过效果的都是加入了的
 */
export const storedSceneModelsSchema = z
  .object({
    added: z.array(z.string().min(1)),
    hidden: z.array(z.string().min(1)),
    effects: z.record(z.string(), z.string().min(1))
  })
  .refine(
    ({ added, hidden, effects }) =>
      new Set(added).size === added.length &&
      hidden.every(id => added.includes(id)) &&
      Object.keys(effects).every(id => added.includes(id)),
    { message: '加入的模型有重复，或者隐藏的、换过效果的没有加入' }
  );

export type StoredSceneModels = z.infer<typeof storedSceneModelsSchema>;

/** 模型拥有者里要记下的几项 */
export interface SceneModelsRecord {
  readonly added: readonly string[];
  readonly hidden: ReadonlySet<string>;
  readonly effects: ReadonlyMap<string, string>;
}

/** 当前状态的存储格式：只记加入了的模型的隐藏和效果 */
export function toStoredSceneModels({ added, hidden, effects }: SceneModelsRecord): StoredSceneModels {
  return {
    added: [...added],
    hidden: added.filter(id => hidden.has(id)),
    effects: Object.fromEntries(added.flatMap(id => (effects.has(id) ? [[id, effects.get(id) ?? '']] : [])))
  };
}

/**
 * 记下的模型按清单合并（ADR 0167）：清单里没有了的（换了服务器、站点缺这个模型，ADR 0164）丢掉；
 * 换过的效果只留白膜、清单里还有的那一种，其余按默认效果
 */
export function restoredSceneModels(stored: StoredSceneModels, models: readonly SceneModel[]): SceneModelsRecord {
  const known = new Map(models.map(model => [model.id, model]));
  const added = stored.added.filter(id => known.has(id));
  const effects = new Map(
    Object.entries(stored.effects).filter(([id, effectId]) => {
      const model = known.get(id);
      return model?.kind === 'white' && model.effects.some(effect => effect.id === effectId);
    })
  );
  return { added, hidden: new Set(stored.hidden.filter(id => known.has(id))), effects };
}
