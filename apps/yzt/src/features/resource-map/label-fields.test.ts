// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CLASS_FIELD, filterFieldsOf } from './filter-fields';
import { labeledCodes, labelFieldsOf } from './label-fields';

describe('labelFieldsOf', () => {
  it('学校的 type 叫"办学类型"，和过滤里一样，不和分类的"分类"混（用户 2026-11-24）', () => {
    for (const code of ['csxhjctb_xxa', 'csxhjctb_xxp']) {
      expect(labelFieldsOf(code).find(({ field }) => field === 'type')?.name).toBe('办学类型');
    }
  });

  it('同一个属性在标注和过滤里叫法一致', () => {
    const mismatches = labeledCodes().flatMap(code =>
      filterFieldsOf(code)
        .filter(({ id }) => id !== CLASS_FIELD)
        .flatMap(({ id, label }) => {
          const option = labelFieldsOf(code).find(({ field }) => field === id);
          return option && option.name !== label ? [`${code}.${id}：标注叫${option.name}，过滤叫${label}`] : [];
        })
    );
    expect(mismatches).toStrictEqual([]);
  });
});
