// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ISOLATION_RELEASE_TIMEOUT, splatShares } from './splat-share';

const IDS = ['tomb', 'cws', 'tsm'];
const budgets = (shares: ReturnType<typeof splatShares>) => Object.fromEntries(shares.budgets);

describe('splatShares（ADR 0156 R.5）', () => {
  it('没有隔离、隔离的是瓦片集时按份平分，不等', () => {
    const plain = splatShares({ total: 3000, ids: IDS, isolated: null, holding: new Set(IDS), waited: 0 });
    expect(budgets(plain)).toStrictEqual({ tomb: 1000, cws: 1000, tsm: 1000 });
    expect(plain.waiting).toBe(false);
    const tileset = splatShares({ total: 3000, ids: IDS, isolated: 'station', holding: new Set(IDS), waited: 0 });
    expect(budgets(tileset)).toStrictEqual({ tomb: 1000, cws: 1000, tsm: 1000 });
  });

  it('隔离一份：别的还占着数据时它仍按平分、接着等；都放掉以后它拿全部', () => {
    const before = splatShares({ total: 3000, ids: IDS, isolated: 'tomb', holding: new Set(['tomb', 'cws']), waited: 100 });
    expect(budgets(before)).toStrictEqual({ tomb: 1000, cws: 1, tsm: 1 });
    expect(before.waiting).toBe(true);
    const after = splatShares({ total: 3000, ids: IDS, isolated: 'tomb', holding: new Set(['tomb']), waited: 2500 });
    expect(budgets(after)).toStrictEqual({ tomb: 3000, cws: 1, tsm: 1 });
    expect(after.waiting).toBe(false);
  });

  it('等到上限还没放掉（库停止细化的调度器不再放）：不再等，隔离的那份拿全部', () => {
    const stuck = splatShares({
      total: 3000,
      ids: IDS,
      isolated: 'tomb',
      holding: new Set(['cws']),
      waited: ISOLATION_RELEASE_TIMEOUT
    });
    expect(budgets(stuck)).toStrictEqual({ tomb: 3000, cws: 1, tsm: 1 });
    expect(stuck.waiting).toBe(false);
  });
});
