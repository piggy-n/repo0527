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
const conditions: SimulationConditions = { years: [2025, 2026], cityCodes: ALL, indicatorIds: ['A-31', 'A-39'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });

// 默认时长下的时间点（毫秒）：条件解析 1300 开始，三路数据准备 3100 开始、6100 全部完成，
// 数据核查到 8500，空间分析到 13700，22100 完成
const PREP_AT = 3100;
const QC_AT = 6100;
const SPATIAL_AT = 8500;
const DONE_AT = 22_100;
// 从空间分析开始到完成
const FROM_SPATIAL = DONE_AT - SPATIAL_AT;

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

// 计算到完成
async function runToDone({ engine, advanceTo }: Context, params = defaultParams()) {
  engine.start(conditions, params);
  await advanceTo(DONE_AT);
}

describe('推进', () => {
  it('先规划步骤，再逐层执行：数据准备三路并行，一路不停到完成', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
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
    await advanceTo(SPATIAL_AT);
    expect(statusesOf(['qc', 'spatial'], engine)).toEqual(['done', 'running']);
  });

  it('完成时生成第一版：结果按这一轮的参数计算，没有改动', async () => {
    using ctx = await setup();
    const { engine, clock, calculator, advanceTo } = ctx;
    const params = withPatch({ rule: 'old' });
    engine.start(conditions, params);

    await advanceTo(DONE_AT - 1);
    expect(engine.state.status).toBe('running');
    expect(engine.state.steps.report.status).toBe('running');
    await clock.advance(1);
    expect(engine.state.status).toBe('done');
    expect(engine.state.versions).toEqual([
      {
        index: 0,
        label: 'v1',
        params,
        result: calculator.compute(conditions, params),
        baseIndex: null,
        baseParams: params,
        changes: []
      }
    ]);
    expect(clock.pending).toBe(0);
  });

  it('不合法的调用抛错：条件不完整、未知指标、没在计算时干预、计算中指定版本', async () => {
    using ctx = await setup();
    const { engine } = ctx;
    expect(() => engine.start({ ...conditions, indicatorIds: [] }, defaultParams())).toThrow('计算条件不完整');
    expect(() => engine.start({ ...conditions, indicatorIds: ['G01-6'] }, defaultParams())).toThrow('计算不支持指标 G01-6');
    expect(() => engine.apply(withPatch({ rule: 'old' }))).toThrow('计算没有在进行');

    engine.start(conditions, defaultParams());
    expect(() => engine.apply(withPatch({ rule: 'old' }), { baseIndex: 0 })).toThrow('只能基于当前参数');
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

describe('计算中的人工干预', () => {
  it('参数没变：什么也不做', async () => {
    using ctx = await setup();
    const { engine, clock } = ctx;
    engine.start(conditions, defaultParams());
    await clock.advance(PLANNING_DURATION);
    const { revision } = engine.state;

    expect(engine.apply(withPatch({}))).toBe('unchanged');
    expect(engine.state.revision).toBe(revision);
  });

  it('还没执行到的步骤：保存参数，执行到时生效', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    const base = engine.state;
    engine.start(conditions, defaultParams());
    await clock.advance(PLANNING_DURATION);

    expect(engine.apply(withPatch({ rule: 'old' }))).toBe('saved');
    expect(engine.state.params.rule).toBe('old');
    expect(engine.state.steps.spatial).toEqual({ status: 'waiting', human: true, redo: false });
    expect(engine.state.steps.parse.status).toBe('running');
    expect(base.status).toBe('idle');

    await advanceTo(DONE_AT);
    expect(engine.state.status).toBe('done');
    expect(engine.state.versions[0]?.changes).toEqual(['rule']);
  });

  it('已经执行过的步骤：作废这一轮，受影响的待更新，其余沿用，从改动的步骤重算', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_AT + 1000);

    expect(engine.apply(withPatch({ popChange: 10 }))).toBe('rerun');
    expect(engine.state.status).toBe('running');
    expect(engine.state.restart).toBe('pop');
    expect(engine.state.adjustment).toEqual({ from: defaultParams(), changes: ['popChange'] });
    expect(statuses(engine)).toEqual({
      parse: 'reused',
      pop: 'stale',
      poi: 'reused',
      land: 'reused',
      qc: 'stale',
      spatial: 'waiting',
      compute: 'waiting',
      evaluate: 'waiting',
      report: 'waiting'
    });
    expect(engine.state.steps.pop.human).toBe(true);
    expect(engine.progress('qc')).toBe(0);
    // 空间分析还没开始，改它的参数只保存
    expect(engine.apply(withPatch({ popChange: 10, rule: 'old' }))).toBe('saved');

    await clock.advance(RERUN_DELAY - 1);
    expect(engine.state.steps.pop.status).toBe('stale');
    await clock.advance(1);
    expect(engine.state.steps.pop.status).toBe('running');
    await clock.advance(2600);
    expect(statusesOf(['pop', 'qc'], engine)).toEqual(['done', 'running']);
    await clock.advance(2400);
    expect(statusesOf(['qc', 'spatial'], engine)).toEqual(['done', 'running']);
  });

  it('改了正在执行的步骤：并行的步骤也重新开始，旧的计时作废', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(PREP_AT + 1000);

    expect(engine.apply(withPatch({ popChange: 10 }))).toBe('rerun');
    expect(statusesOf(['parse', 'pop', 'poi', 'land', 'qc'], engine)).toEqual(['reused', 'stale', 'stale', 'stale', 'waiting']);

    // 原来的用地数据会在 PREP_AT + 2200 完成
    await clock.advance(RERUN_DELAY + 2199);
    expect(statusesOf(['pop', 'poi', 'land'], engine)).toEqual(['running', 'running', 'running']);
    await clock.advance(1);
    expect(engine.state.steps.land.status).toBe('done');
    await clock.advance(800);
    expect(engine.state.steps.qc.status).toBe('running');
  });
});

describe('planApply', () => {
  it('只说会怎样处理，不改状态', async () => {
    using ctx = await setup();
    const { engine, advanceTo } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(QC_AT + 1000);
    const { revision } = engine.state;

    expect(engine.planApply(withPatch({ rule: 'old' }))).toEqual({
      outcome: 'saved',
      restart: 'spatial',
      changes: ['rule'],
      baseIndex: null
    });
    expect(engine.planApply(withPatch({ popChange: 10 })).outcome).toBe('rerun');
    expect(engine.planApply(defaultParams()).outcome).toBe('unchanged');
    expect(engine.state.revision).toBe(revision);
  });

  it('结果阶段：改动按所基于的版本，重算起点按上一轮的参数', async () => {
    using ctx = await setup();
    const { engine } = ctx;
    await runToDone(ctx);
    expect(engine.planApply(withPatch({ targets: { ...defaultParams().targets, 'A-31': 75 } }))).toEqual({
      outcome: 'rerun',
      restart: 'evaluate',
      changes: ['targets'],
      baseIndex: 0
    });
  });
});

describe('结果阶段的人工干预', () => {
  it('基于最新一版：只重算受影响的步骤，生成新版本', async () => {
    using ctx = await setup();
    const { engine, clock, calculator } = ctx;
    await runToDone(ctx);
    const v1 = engine.state.versions[0];

    const params = withPatch({ recognition: 'intersect' });
    expect(engine.apply(params)).toBe('rerun');
    expect(engine.state.restart).toBe('spatial');
    expect(statusesOf(['parse', 'qc', 'spatial', 'report'], engine)).toEqual(['reused', 'reused', 'stale', 'stale']);
    expect(engine.state.baseIndex).toBe(0);
    expect(engine.state.baseParams).toBe(v1?.params);

    await clock.advance(RERUN_DELAY + FROM_SPATIAL);
    expect(engine.state.status).toBe('done');
    expect(engine.state.versions).toHaveLength(2);
    expect(engine.state.versions[1]).toMatchObject({ label: 'v2', baseIndex: 0, changes: ['recognition'], params });
    expect(engine.state.versions[1]?.result).toEqual(calculator.compute(conditions, params));
  });

  it('基于更早的版本：改动按所基于的版本记，复用按上一轮实际的参数判断', async () => {
    using ctx = await setup();
    const { engine, clock } = ctx;
    await runToDone(ctx);
    engine.apply(withPatch({ rule: 'old' }));
    await clock.advance(RERUN_DELAY + FROM_SPATIAL);

    const v1 = engine.state.versions[0]?.params ?? defaultParams();
    const params = { ...v1, targets: { ...v1.targets, 'A-31': 75 } };
    expect(engine.apply(params, { baseIndex: 0 })).toBe('rerun');
    // 相对 v2 计算规程也变回了新规程，从空间分析重算
    expect(engine.state.restart).toBe('spatial');
    expect(engine.state.baseIndex).toBe(0);

    await clock.advance(RERUN_DELAY + FROM_SPATIAL);
    expect(engine.state.versions[2]).toMatchObject({ label: 'v3', baseIndex: 0, changes: ['targets'], params });
  });

  it('与所基于的版本相同：不生成新版本；没有这个版本时抛错', async () => {
    using ctx = await setup();
    const { engine } = ctx;
    await runToDone(ctx);
    const { revision } = engine.state;

    expect(engine.apply(defaultParams(), { baseIndex: 0 })).toBe('unchanged');
    expect(engine.state.revision).toBe(revision);
    expect(() => engine.apply(withPatch({ rule: 'old' }), { baseIndex: 1 })).toThrow('没有第 1 个版本');
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
    expect(engine.state).toMatchObject({ status: 'idle', paused: true, conditions: null, versions: [] });
    expect(new Set(Object.values(statuses(engine)))).toEqual(new Set(['waiting']));
    expect(clock.pending).toBe(0);
    release();
    const { revision } = engine.state;
    await clock.advance(60_000);
    expect(engine.state.revision).toBe(revision);
  });

  it('重新开始：上一次计算作废，按新的条件从头开始', async () => {
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

  it('释放后：进行中的计算作废，不再通知，方法抛错', async () => {
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

// 条件解析 4000，其余按基础时长；相交即算时空间分析变成 9000
const durationsOf = (_: SimulationConditions, params: SimulationParams) => {
  const base = Object.fromEntries(STEPS.map(step => [step.id, step.duration])) as Record<StepId, number>;
  return { ...base, parse: 4000, spatial: params.recognition === 'intersect' ? 9000 : base.spatial };
};

describe('按内容给的时长', () => {
  it('各步按给出的时长推进，进度按它算；保存参数时进行中的一步不改时长', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const clock = new ManualClock();
    using engine = new SimulationEngine({ calculator, clock, durations: durationsOf });
    engine.start(conditions, defaultParams());
    expect(engine.state.durations.parse).toBe(4000);
    await clock.advance(PLANNING_DURATION + 2000);
    expect(engine.progress('parse')).toBeCloseTo(0.5, 6);

    expect(engine.apply(withPatch({ recognition: 'intersect' }))).toBe('saved');
    expect([engine.state.durations.parse, engine.state.durations.spatial]).toEqual([4000, 9000]);
  });
});

describe('重算的标记', () => {
  it('干预重算时开始过的步骤标为要重算，重算完成后清除；没开始过的不标', async () => {
    using ctx = await setup();
    const { engine, advanceTo, clock } = ctx;
    engine.start(conditions, defaultParams());
    await advanceTo(SPATIAL_AT + 100);
    engine.apply(withPatch({ popChange: 10 }));

    expect([engine.state.steps.pop, engine.state.steps.qc, engine.state.steps.compute]).toMatchObject([
      { status: 'stale', redo: true },
      { status: 'stale', redo: true },
      { status: 'waiting', redo: false }
    ]);
    expect(engine.state.steps.parse).toMatchObject({ status: 'reused', redo: false });
    expect(engine.state.previousConditions).toBe(conditions);
    await clock.advance(RERUN_DELAY + 100);
    expect(engine.state.steps.pop).toMatchObject({ status: 'running', redo: true });
    await clock.advance(FROM_SPATIAL + SPATIAL_AT);
    expect(engine.state.status).toBe('done');
    expect(STEPS.some(({ id }) => engine.state.steps[id].redo)).toBe(false);
  });
});

describe('换条件重算', () => {
  const moreCities: SimulationConditions = { ...conditions, cityCodes: ['320100', '320500'], indicatorIds: ['A-31'] };

  it('开始过的步骤标为待更新，从条件解析重算；记下换之前的条件，版本作废', async () => {
    using ctx = await setup();
    const { engine, clock, advanceTo } = ctx;
    await runToDone(ctx);
    expect(engine.state.versions).toHaveLength(1);

    const params = withPatch({ rule: 'old' });
    engine.restart(moreCities, params);
    expect(engine.state).toMatchObject({
      status: 'running',
      conditions: moreCities,
      previousConditions: conditions,
      params,
      baseParams: params,
      versions: [],
      restart: 'parse',
      adjustment: { from: defaultParams(), changes: ['rule'] }
    });
    expect(new Set(Object.values(statuses(engine)))).toEqual(new Set(['stale']));

    await clock.advance(RERUN_DELAY);
    expect(engine.state.steps.parse).toMatchObject({ status: 'running', redo: true });
    await advanceTo(clock.now() + DONE_AT);
    expect(engine.state.status).toBe('done');
    expect(engine.state.versions.map(version => version.label)).toEqual(['v1']);
  });

  it('计算中换条件：没开始过的步骤仍是等待；还没开始计算时不能换', async () => {
    using ctx = await setup();
    const { engine, advanceTo } = ctx;
    expect(() => engine.restart(moreCities, defaultParams())).toThrow('计算没有开始');
    engine.start(conditions, defaultParams());
    await advanceTo(QC_AT + 100);
    engine.restart(moreCities, defaultParams());
    expect(statusesOf(['parse', 'qc', 'spatial'], engine)).toEqual(['stale', 'stale', 'waiting']);
    expect(() => engine.restart({ ...moreCities, indicatorIds: [] }, defaultParams())).toThrow('计算条件不完整');
  });
});
