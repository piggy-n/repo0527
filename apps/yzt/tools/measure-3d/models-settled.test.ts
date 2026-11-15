// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelState } from './bench-api.ts';
import { modelsSettled } from './models-settled.ts';

const WHITE = 'xuzhou/white/a/tileset.json';
const STATION = 'xuzhou/white/b/tileset.json';
const SPLAT = 'pc';

const ready: ModelState = { state: 'ready', error: null };
const loading: ModelState = { state: 'loading', error: null };
const failed: ModelState = { state: 'failed', error: 'HTTP 504' };

describe('modelsSettled', () => {
  it('一份就绪、另一份还在整理索引（状态是加载中或者还没有）：没准备好', () => {
    expect(modelsSettled({ [WHITE]: ready, [STATION]: loading }, [WHITE, STATION])).toBe(false);
    expect(modelsSettled({ [WHITE]: ready }, [WHITE, STATION])).toBe(false);
    expect(modelsSettled({}, [WHITE])).toBe(false);
  });

  it('每份都就绪：准备好了', () => {
    expect(modelsSettled({ [WHITE]: ready, [STATION]: ready }, [WHITE, STATION])).toBe(true);
  });

  it('失败的不挡：不然每遍都等到超时，失败的原因另写进说明', () => {
    expect(modelsSettled({ [WHITE]: ready, [STATION]: failed }, [WHITE, STATION])).toBe(true);
  });

  it('泼溅和瓦片集一起看：泼溅还没有状态时没准备好', () => {
    expect(modelsSettled({ [WHITE]: ready }, [WHITE, SPLAT])).toBe(false);
    expect(modelsSettled({ [WHITE]: ready, [SPLAT]: ready }, [WHITE, SPLAT])).toBe(true);
  });

  it('不在预期里的模型不影响', () => {
    expect(modelsSettled({ [WHITE]: ready, other: loading }, [WHITE])).toBe(true);
  });
});
