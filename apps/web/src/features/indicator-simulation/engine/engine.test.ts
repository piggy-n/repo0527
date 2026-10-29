// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { type Calculator, createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { type EngineCalculator, type EngineState, SimulationEngine, type StepStatus } from './engine';
import { PLANNING_DURATION, RERUN_DELAY, type StepId, STEPS } from './steps';
import { ManualClock } from './test-clock';

const ALL = JIANGSU_CITIES.map(city => city.code);
// 覆盖率类和人均类各一项
const conditions: SimulationConditions = { years: [2025, 2026], cityCodes: ALL, indicatorIds: ['B-65', 'A-39'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });

// 默认时长下的时间点（毫秒）：条件解析 1300 开始，三路数据准备 3100 开始、6100 全部完成，数据核查 7300 停下来问
const PREP_AT = 3100;
const QC_AT = 6100;
const QC_CHECKPOINT_AT = 7300;
// 确认数据核查后，空间分析在 1200 后开始；确认空间分析后，到完成还要 13600
const AFTER_QC = 1200;
const AFTER_SPATIAL = 13_600;

async function setup(patch: Partial<EngineCalculator> = {}) {
  const calculator: Calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  const engine = new SimulationEngine({ calculator: { ...calculator, ...patch }, clock });
  const advanceTo = (time: number) => clock.advance(time - clock.now());
  return { calculator, clock, engine, advanceTo, [Symbol.dispose]: () => engine[Symbol.dispose]() };
}

type Context = Awaited<ReturnType<typeof setup>>;

const statuses = (engine: SimulationEngine): Record<string, StepStatus> =>
  Object.fromEntries(STEPS.map(({ id }) => [id, engine.state.steps[id].status]));

const statusesOf = (ids: readonly StepId[], engine: SimulationEngine) => ids.map(id => engine.state.steps[id].status);

// 按默认参数确认两个确认点，推演到完成
async function runToDone({ engine, clock, advanceTo }: Context, params = defaultParams()) {
  engine.start(conditions, params);
  await advanceTo(QC_CHECKPOINT_AT);
  engine.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
  await clock.advance(AFTER_QC);
  engine.resolveCheckpoint({ step: 'spatial' });
  await clock.advance(AFTER_SPATIAL);
}

describe('推进', () => {
  it('先规划步骤，再逐层执行：数据准备三路并行，数据核查在中途停下来问缺失人口', async () => {
    using ctx = await setup();
    const { engine, clock, calculator, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    expect(engine.state.status).toBe('planning');
    expect(new Set(Object.values(statuses(engine)))).toEqual(new Set(['waiting']));

    await clock.advance(PLANNING_DURATION - 1);
    expect(engine.state.status).toBe('planning');
    await clock.advance(1);
    expect(engine.state.status).toBe('running');
    expect(engine.state.steps.parse.status).toBe('running');
    await clock.advance(900);
    expect(engine.progress('parse')).toBeCloseTo(0.5, 6);

    await advanceTo(PREP_AT);
    expect(statusesOf(['parse', 'pop', 'poi', 'land'], engine)).toEqual(['done', 'running', 'running', 'running']);
    // 用地 2200 最先完成，设施 3000 最晚，数据核查等三路都完成
    await advanceTo(PREP_AT + 2200);
    expect(statusesOf(['pop', 'poi', 'land', 'qc'], engine)).toEqual(['running', 'running', 'done', 'waiting']);
    await advanceTo(QC_AT);
    expect(statusesOf(['poi', 'qc'], engine)).toEqual(['done', 'running']);

    await advanceTo(QC_CHECKPOINT_AT);
    expect(engine.state.status).toBe('checkpoint');
    expect(engine.state.steps.qc.status).toBe('checkpoint');
    const missing = calculator.missingDistricts(2026, ALL);
    expect(missing).toHaveLength(2);
    expect(engine.state.checkpoint).toEqual({
      step: 'qc',
      year: 2026,
      missing: missing.map(district => ({
        district,
        imputed: calculator.imputedPopulation(district, 2026, 'resident')
      }))
    });
    expect(engine.progress('qc')).toBeCloseTo(0.5, 6);

    // 等人确认时不计时，后面的步骤不开始
    await clock.advance(60_000);
    expect(engine.state.status).toBe('checkpoint');
    expect(engine.progress('qc')).toBeCloseTo(0.5, 6);
    expect(engine.state.steps.spatial.status).toBe('waiting');
  });

  it('确认缺失处理后继续；空间分析一开始就确认参数；完成时生成第一版', async () => {
    using ctx = await setup();
    const { engine, clock, calculator, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_CHECKPOINT_AT);

    engine.resolveCheckpoint({ step: 'qc', missing: { kind: 'exclude' } });
    expect(engine.state.status).toBe('running');
    expect(engine.state.checkpoint).toBeNull();
    expect(engine.state.params.missing).toEqual({ kind: 'exclude' });
    expect(engine.state.steps.qc).toEqual({ status: 'running', human: true });
    expect(engine.state.decided).toEqual({ qc: true, spatial: false });

    await clock.advance(AFTER_QC - 1);
    expect(engine.state.steps.qc.status).toBe('running');
    await clock.advance(1);
    expect(engine.state.steps.qc.status).toBe('done');
    expect(engine.state.status).toBe('checkpoint');
    expect(engine.state.checkpoint).toEqual({ step: 'spatial' });

    engine.resolveCheckpoint({ step: 'spatial' });
    expect(engine.state.steps.spatial).toEqual({ status: 'running', human: true });
    await clock.advance(AFTER_SPATIAL - 1);
    expect(engine.state.status).toBe('running');
    expect(engine.state.steps.report.status).toBe('running');
    await clock.advance(1);
    expect(engine.state.status).toBe('done');

    const params = withPatch({ missing: { kind: 'exclude' } });
    expect(engine.state.versions).toHaveLength(1);
    expect(engine.state.versions[0]).toEqual({
      index: 0,
      label: 'v1',
      params,
      result: calculator.compute(conditions, params),
      baseIndex: null,
      baseParams: defaultParams(),
      changes: ['missing']
    });
    expect(clock.pending).toBe(0);
  });

  it('只有人均类指标时空间分析不停下来；所选范围没有缺失人口时数据核查也不停', async () => {
    using ctx = await setup({ missingDistricts: () => [] });
    const { engine, advanceTo } = ctx;
    engine.start({ ...conditions, indicatorIds: ['A-39'] }, defaultParams());
    await advanceTo(QC_CHECKPOINT_AT);
    expect(engine.state.status).toBe('running');

    await advanceTo(QC_CHECKPOINT_AT + AFTER_QC + AFTER_SPATIAL);
    expect(engine.state.status).toBe('done');
    expect(engine.state.versions[0]?.changes).toEqual([]);
  });

  it('不合法的调用抛错：条件不完整、未知指标、确认的不是当前确认点、没在推演时干预', async () => {
    using ctx = await setup();
    const { engine, advanceTo } = ctx;
    expect(() => engine.start({ ...conditions, indicatorIds: [] }, defaultParams())).toThrow('推演条件不完整');
    expect(() => engine.start({ ...conditions, indicatorIds: ['G01-6'] }, defaultParams())).toThrow('推演不支持指标 G01-6');
    expect(() => engine.apply(withPatch({ walkSpeed: 75 }))).toThrow('推演没有在进行');

    engine.start(conditions, defaultParams());
    expect(() => engine.apply(withPatch({ walkSpeed: 75 }), { baseIndex: 0 })).toThrow('只能基于当前参数');
    await advanceTo(QC_CHECKPOINT_AT);
    expect(() => engine.resolveCheckpoint({ step: 'spatial' })).toThrow('没有在等待确认');
    expect(engine.state.status).toBe('checkpoint');
  });

  it('快照整体替换：旧快照不变，每次变化 revision 加一并通知', async () => {
    using ctx = await setup();
    const { engine, clock } = ctx;
    const seen: number[] = [];
    engine.on('change', state => {
      expect(state).toBe(engine.state);
      seen.push(state.revision);
    });
    engine.start(conditions, defaultParams());
    const planning = engine.state;
    await clock.advance(PLANNING_DURATION);

    expect(planning.status).toBe('planning');
    expect(planning.steps.parse.status).toBe('waiting');
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual(seen.map((_, index) => seen[0] + index));
  });
});

describe('推演中的人工干预', () => {
  it('参数没变：什么也不做', async () => {
    using ctx = await setup();
    const { engine, clock } = ctx;
    engine.start(conditions, defaultParams());
    await clock.advance(PLANNING_DURATION);
    const { revision } = engine.state;

    expect(engine.apply(withPatch({}))).toBe('unchanged');
    expect(engine.state.revision).toBe(revision);
  });

  it('还没执行到的步骤：保存参数，执行到时生效；改了确认点的参数，就不再停下来问', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await clock.advance(PLANNING_DURATION);

    expect(engine.apply(withPatch({ walkSpeed: 75 }))).toBe('saved');
    expect(engine.state.params.walkSpeed).toBe(75);
    expect(engine.state.steps.spatial).toEqual({ status: 'waiting', human: true });
    expect(engine.state.decided.spatial).toBe(true);
    expect(engine.state.steps.parse.status).toBe('running');

    await advanceTo(QC_CHECKPOINT_AT);
    engine.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
    await clock.advance(AFTER_QC);
    expect(engine.state.status).toBe('running');
    expect(engine.state.steps.spatial.status).toBe('running');

    await clock.advance(AFTER_SPATIAL);
    expect(engine.state.versions[0]?.changes).toEqual(['walkSpeed']);
  });

  it('当前确认点的参数：作为确认点的决定，接着执行', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_CHECKPOINT_AT);

    const manual = withPatch({ missing: { kind: 'manual', values: { '320117': 52.3 } } });
    expect(engine.apply(manual)).toBe('resolved');
    expect(engine.state.status).toBe('running');
    expect(engine.state.checkpoint).toBeNull();
    expect(engine.state.params).toBe(manual);
    expect(engine.state.steps.qc).toEqual({ status: 'running', human: true });

    await clock.advance(AFTER_QC);
    expect(engine.state.checkpoint).toEqual({ step: 'spatial' });
    const faster = { ...manual, walkSpeed: 80 };
    expect(engine.apply(faster)).toBe('resolved');
    expect(engine.state.steps.spatial.status).toBe('running');

    await clock.advance(AFTER_SPATIAL);
    expect(engine.state.versions[0]?.params).toBe(faster);
    expect(engine.state.versions[0]?.changes).toEqual(['missing', 'walkSpeed']);
  });

  it('已经执行过的步骤：作废这一轮，受影响的待更新，其余沿用，从改动的步骤重算', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_CHECKPOINT_AT);
    engine.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
    await clock.advance(AFTER_QC);
    expect(engine.state.checkpoint).toEqual({ step: 'spatial' });

    expect(engine.apply(withPatch({ popCaliber: 'registered' }))).toBe('rerun');
    expect(engine.state.status).toBe('running');
    expect(engine.state.restart).toBe('pop');
    expect(engine.state.checkpoint).toBeNull();
    expect(statuses(engine)).toEqual({
      parse: 'reused',
      pop: 'stale',
      poi: 'reused',
      land: 'reused',
      qc: 'stale',
      spatial: 'stale',
      compute: 'waiting',
      evaluate: 'waiting',
      report: 'waiting'
    });
    expect(engine.state.steps.pop.human).toBe(true);
    expect(engine.progress('qc')).toBe(0);
    // 待更新的步骤还没重算，改它的参数只保存
    expect(engine.apply(withPatch({ popCaliber: 'registered', walkSpeed: 70 }))).toBe('saved');

    await clock.advance(RERUN_DELAY - 1);
    expect(engine.state.steps.pop.status).toBe('stale');
    await clock.advance(1);
    expect(engine.state.steps.pop.status).toBe('running');
    await clock.advance(2600);
    expect(statusesOf(['pop', 'qc'], engine)).toEqual(['done', 'running']);
    // 数据核查已经确认过，不再停
    await clock.advance(2400);
    expect(engine.state.steps.qc.status).toBe('done');
    expect(engine.state.steps.spatial.status).toBe('running');
  });

  it('重算时没确认过的确认点还要问', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_CHECKPOINT_AT);
    engine.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
    await clock.advance(AFTER_QC);

    engine.apply(withPatch({ popCaliber: 'registered' }));
    await clock.advance(RERUN_DELAY + 2600 + 2400);
    expect(engine.state.checkpoint).toEqual({ step: 'spatial' });
  });

  it('改了正在执行的步骤：并行的步骤也重新开始，旧的计时作废', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(PREP_AT + 1000);

    expect(engine.apply(withPatch({ popCaliber: 'registered' }))).toBe('rerun');
    expect(statusesOf(['parse', 'pop', 'poi', 'land', 'qc'], engine)).toEqual([
      'reused',
      'stale',
      'stale',
      'stale',
      'waiting'
    ]);

    // 原来的用地数据会在 PREP_AT + 2200 完成
    await clock.advance(RERUN_DELAY + 2199);
    expect(statusesOf(['pop', 'poi', 'land'], engine)).toEqual(['running', 'running', 'running']);
    await clock.advance(1);
    expect(engine.state.steps.land.status).toBe('done');
    await clock.advance(800);
    expect(engine.state.steps.qc.status).toBe('running');
  });
});

describe('结果阶段的人工干预', () => {
  it('基于最新一版：只重算受影响的步骤，生成新版本', async () => {
    using ctx = await setup();
    const { engine, clock, calculator } = ctx;
    await runToDone(ctx);
    const v1 = engine.state.versions[0];

    const params = withPatch({ walkSpeed: 75 });
    expect(engine.apply(params)).toBe('rerun');
    expect(engine.state.restart).toBe('spatial');
    expect(statusesOf(['parse', 'qc', 'spatial', 'report'], engine)).toEqual(['reused', 'reused', 'stale', 'stale']);
    expect(engine.state.baseIndex).toBe(0);
    expect(engine.state.baseParams).toBe(v1?.params);

    // 空间分析确认过了，不再停
    await clock.advance(RERUN_DELAY + AFTER_SPATIAL);
    expect(engine.state.status).toBe('done');
    expect(engine.state.versions).toHaveLength(2);
    expect(engine.state.versions[1]).toMatchObject({ label: 'v2', baseIndex: 0, changes: ['walkSpeed'], params });
    expect(engine.state.versions[1]?.result).toEqual(calculator.compute(conditions, params));
  });

  it('基于更早的版本：改动按所基于的版本记，复用按上一轮实际的参数判断', async () => {
    using ctx = await setup();
    const { engine, clock } = ctx;
    await runToDone(ctx);
    engine.apply(withPatch({ walkSpeed: 75 }));
    await clock.advance(RERUN_DELAY + AFTER_SPATIAL);

    const v1 = engine.state.versions[0]?.params ?? defaultParams();
    const params = { ...v1, targets: { ...v1.targets, 'B-65': 75 } };
    expect(engine.apply(params, { baseIndex: 0 })).toBe('rerun');
    // 相对 v2 步行速度也变回了 60，从空间分析重算
    expect(engine.state.restart).toBe('spatial');
    expect(engine.state.baseIndex).toBe(0);

    await clock.advance(RERUN_DELAY + AFTER_SPATIAL);
    expect(engine.state.versions[2]).toMatchObject({ label: 'v3', baseIndex: 0, changes: ['targets'], params });
  });

  it('与所基于的版本相同：不生成新版本；没有这个版本时抛错', async () => {
    using ctx = await setup();
    const { engine } = ctx;
    await runToDone(ctx);
    const { revision } = engine.state;

    expect(engine.apply(defaultParams(), { baseIndex: 0 })).toBe('unchanged');
    expect(engine.state.revision).toBe(revision);
    expect(() => engine.apply(withPatch({ walkSpeed: 75 }), { baseIndex: 1 })).toThrow('没有第 1 个版本');
  });

  it('计算出错：进入 failed，记下错误', async () => {
    const error = new Error('计算出错');
    using ctx = await setup({
      compute: () => {
        throw error;
      }
    });
    await runToDone(ctx);

    expect(ctx.engine.state.status).toBe('failed');
    expect(ctx.engine.state.error).toBe(error);
  });
});

describe('暂停、停止、释放', () => {
  it('暂停期间时间不走，步骤和进度都停住；几处暂停全部解除才继续', async () => {
    using ctx = await setup();
    const { engine, clock } = ctx;
    engine.start(conditions, defaultParams());
    await clock.advance(PLANNING_DURATION + 900);

    const first = engine.pause();
    const second = engine.pause();
    expect(engine.state.paused).toBe(true);
    await clock.advance(10_000);
    expect(engine.state.steps.parse.status).toBe('running');
    expect(engine.progress('parse')).toBeCloseTo(0.5, 6);

    first();
    first();
    expect(engine.state.paused).toBe(true);
    await clock.advance(10_000);
    expect(engine.state.steps.parse.status).toBe('running');

    second();
    expect(engine.state.paused).toBe(false);
    await clock.advance(899);
    expect(engine.state.steps.parse.status).toBe('running');
    await clock.advance(1);
    expect(engine.state.steps.parse.status).toBe('done');
  });

  it('停止：回到空闲，之后旧的计时不再改动状态；暂停不受影响', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(PREP_AT + 1000);
    const release = engine.pause();

    engine.stop();
    expect(engine.state).toMatchObject({
      status: 'idle',
      paused: true,
      conditions: null,
      checkpoint: null,
      versions: []
    });
    expect(new Set(Object.values(statuses(engine)))).toEqual(new Set(['waiting']));
    expect(clock.pending).toBe(0);
    release();
    const { revision } = engine.state;
    await clock.advance(60_000);
    expect(engine.state.revision).toBe(revision);
  });

  it('停在确认点时停止：确认点作废', async () => {
    using ctx = await setup();
    const { engine, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_CHECKPOINT_AT);

    engine.stop();
    expect(() => engine.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } })).toThrow('没有在等待确认');
  });

  it('重新开始：上一次推演作废，按新的条件从头开始', async () => {
    using ctx = await setup();
    const { engine, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(2000);

    engine.start({ ...conditions, cityCodes: ['320100'] }, defaultParams());
    expect(engine.state.status).toBe('planning');
    // 第一次的条件解析会在 3100 完成
    await advanceTo(2000 + PREP_AT - 1);
    expect(engine.state.steps.parse.status).toBe('running');
    await advanceTo(2000 + PREP_AT);
    expect(engine.state.steps.parse.status).toBe('done');
    expect(engine.state.conditions?.cityCodes).toEqual(['320100']);
  });

  it('释放后：进行中的推演作废，不再通知，方法抛错', async () => {
    const ctx = await setup();
    const { engine, clock } = ctx;
    const listener = vi.fn<(state: EngineState) => void>();
    engine.on('change', listener);
    engine.start(conditions, defaultParams());
    const release = engine.pause();
    listener.mockClear();

    engine[Symbol.dispose]();
    expect(clock.pending).toBe(0);
    release();
    const { revision } = engine.state;
    await clock.advance(60_000);
    expect(engine.state.revision).toBe(revision);
    expect(listener).not.toHaveBeenCalled();
    expect(() => engine.start(conditions, defaultParams())).toThrow('已释放');
    expect(() => engine.on('change', listener)).toThrow('已释放');
  });
});
