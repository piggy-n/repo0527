// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type EngineState, idleEngineState, type StepState } from '../engine/engine';
import { BASE_DURATIONS, type StepId, STEPS } from '../engine/steps';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { plainText } from '../run/narrative';
import { flowDurations, flowFrame, lineTimings, THINK_MS, TYPE_MS, typedChars } from './frame';
import { flowPlan } from './plan';

const conditions: SimulationConditions = { years: [2025], cityCodes: ['320100'], indicatorIds: ['A-31', 'A-39'] };
const planOf = async () =>
  flowPlan({ calculator: createCalculator(await loadTestAtlas()), conditions, params: { ...defaultParams(), rule: 'old' } });

// 引擎的一份状态：给出各步的状态，其余是空闲时的值
function stateOf(steps: Partial<Record<StepId, Partial<StepState>>>, durations: Record<StepId, number>): EngineState {
  const idle = idleEngineState();
  return {
    ...idle,
    status: 'running',
    conditions,
    durations,
    steps: Object.fromEntries(
      STEPS.map(({ id }) => [id, { status: 'waiting', human: false, redo: false, ...steps[id] }])
    ) as EngineState['steps']
  };
}

describe('lineTimings、flowDurations', () => {
  it('每步先思考 1.1 秒；同一步的句子一句接一句，换节点时多停一下；时长打得完这一步的话，不短于基础时长', async () => {
    const plan = await planOf();
    const timings = lineTimings(plan);
    const of = (step: string) => plan.lines.flatMap((line, index) => (line.step === step ? [timings[index]] : []));
    const parse = of('parse');
    const spatial = of('spatial');
    expect(parse[0]?.start).toBe(THINK_MS);
    // 条件解析的几句都点亮同一个节点；空间分析的前两句换了节点
    expect(parse[1]?.start).toBe((parse[0]?.end ?? 0) + 320);
    expect(spatial[1]?.start).toBe((spatial[0]?.end ?? 0) + 320 + 260);

    const durations = flowDurations(plan);
    for (const { id } of STEPS) {
      expect(durations[id]).toBeGreaterThanOrEqual(BASE_DURATIONS[id]);
    }
    expect(durations.spatial).toBe(Math.max(BASE_DURATIONS.spatial, (spatial.at(-1)?.end ?? 0) + 500));
  });

  it('打字有快慢、标点后停一下；打出的字数按经过的时间，不超出这一句', async () => {
    const plan = await planOf();
    const [line] = plan.lines;
    const [timing] = lineTimings(plan);
    if (!line || !timing) {
      throw new Error('应有第一句');
    }
    const plain = plainText(line.text);
    const text = Array.from({ length: plain.length }, (_, index) => plain.charAt(index));
    const steps = timing.offsets.map((offset, index) => offset - (timing.offsets[index - 1] ?? 0));
    expect(timing.offsets).toHaveLength(text.length);
    expect(timing.end - timing.start).toBe(timing.offsets.at(-1));
    // 普通的字 0.7～1.3 倍，各字不全一样；冒号后的字多停 120 毫秒
    const ordinary = steps.filter((_, index) => !'，、；：。'.includes(text[index] ?? ''));
    expect(Math.min(...ordinary)).toBeGreaterThanOrEqual(Math.floor(TYPE_MS * 0.7));
    expect(Math.max(...ordinary)).toBeLessThanOrEqual(Math.ceil(TYPE_MS * 1.3));
    expect(new Set(ordinary).size).toBeGreaterThan(3);
    const colon = text.indexOf('：');
    expect(steps[colon]).toBeGreaterThanOrEqual(120 + Math.floor(TYPE_MS * 0.7));

    expect(typedChars(timing, timing.start - 10)).toBe(0);
    expect(typedChars(timing, timing.start + (timing.offsets[2] ?? 0))).toBe(3);
    expect(typedChars(timing, 1e6)).toBe(text.length);
  });
});

describe('flowFrame', () => {
  it('规划步骤时什么都没长出来，镜头在第一列', async () => {
    const plan = await planOf();
    const frame = flowFrame(plan, { ...stateOf({}, flowDurations(plan)), status: 'planning' }, () => 0, null);
    expect([...frame.nodes.values()].every(node => node.status === 'hidden')).toBe(true);
    expect(frame.column).toBe(0);
  });

  it('空间分析进行中：打到哪一句，哪个节点在进行；打完的完成，没轮到的还没长出；前面的步骤都完成', async () => {
    const plan = await planOf();
    const durations = flowDurations(plan);
    const timings = lineTimings(plan);
    const second = plan.lines.findIndex(line => line.node === 'sa:A-31:1');
    const at = (timings[second]?.start ?? 0) + 30;
    const state = stateOf(
      { parse: { status: 'done' }, pop: { status: 'done' }, poi: { status: 'done' }, land: { status: 'done' }, qc: { status: 'done' }, spatial: { status: 'running' } },
      durations
    );
    const frame = flowFrame(plan, state, step => (step === 'spatial' ? at / durations.spatial : 1), null);
    expect(frame.nodes.get('qc')?.status).toBe('done');
    expect(frame.nodes.get('sa:A-31:0')?.status).toBe('done');
    expect(frame.nodes.get('sa:A-31:1')).toMatchObject({ status: 'running' });
    expect(frame.nodes.get('sa:A-31:1')?.progress).toBeGreaterThan(0);
    expect(frame.nodes.get('sa:A-39:land')?.status).toBe('hidden');
    expect(frame.nodes.get('calc:A-31')?.status).toBe('hidden');
    expect(frame.column).toBe(3);
  });

  it('一步只有一个节点时整步都在进行：话打完了，步骤没完成也不算完成', async () => {
    const plan = await planOf();
    const durations = flowDurations(plan);
    const frame = flowFrame(plan, stateOf({ parse: { status: 'running' } }, durations), () => 0.99, null);
    expect(frame.nodes.get('parse')).toEqual({ status: 'running', progress: 0.99 });
  });

  it('重算：上一轮出现过的节点在轮到之前是待更新，新出现的节点还没长出', async () => {
    const plan = await planOf();
    const durations = flowDurations(plan);
    const previous = new Set(plan.nodes.map(node => node.key).filter(key => !key.includes('A-39')));
    const state = stateOf(
      { parse: { status: 'done' }, qc: { status: 'stale', redo: true }, compute: { status: 'stale' } },
      durations
    );
    const frame = flowFrame(plan, state, () => 0, previous);
    expect(frame.nodes.get('qc')?.status).toBe('stale');
    // 第一轮没执行到的步骤不标
    expect(frame.nodes.get('calc:A-31')?.status).toBe('hidden');

    // 空间分析重算刚想完：第一个节点在进行，还没轮到的旧节点待更新，新出现的还没长出
    const spatial = stateOf({ spatial: { status: 'running', redo: true } }, durations);
    const thought = (THINK_MS + 10) / durations.spatial;
    const again = flowFrame(plan, spatial, step => (step === 'spatial' ? thought : 1), previous);
    expect(flowFrame(plan, spatial, () => 0, previous).nodes.get('sa:A-31:0')?.status).toBe('stale');
    expect(again.nodes.get('sa:A-31:0')?.status).toBe('running');
    expect(again.nodes.get('sa:A-31:1')?.status).toBe('stale');
    expect(again.nodes.get('sa:A-39:land')?.status).toBe('hidden');
  });
});
