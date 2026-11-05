import type { StyleGroup } from '@mx/map-core';
import type { Position } from 'geojson';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope, shallowRef } from 'vue';
import { polygonsOf } from '@/shared/map/area/area-geometry';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { polygonBounds } from '@/shared/map/region/region-geometry';
import { required } from '@/shared/testing/required';
import { type Calculator, createCalculator } from '../model/calculator';
import { box, geojsonFile, NANJING_RINGS, NINGZHEN_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { createTestEditor } from './test-scope-editor';
import type { ScopeAnalysis, ScopeEditor } from './useScopeEditor';
import type { SimulationModel } from './useSimulationModel';

let calculator: Calculator;
beforeAll(async () => {
  calculator = createCalculator(await loadTestAtlas());
});

let scope: EffectScope | undefined;
afterEach(() => {
  scope?.stop();
  scope = undefined;
});

function setup(initial: SimulationModel = { status: 'ready', calculator }) {
  scope = effectScope();
  const model = shallowRef<SimulationModel>(initial);
  const created = scope.run(() => createTestEditor(model));
  if (!created) {
    throw new Error('没有建出范围弹窗的拥有者');
  }
  return { ...created, model };
}

// 分组里一个数据源的数据
const dataOf = (group: StyleGroup, id: string) => {
  const source = group.sources[id];
  return source?.type === 'geojson' ? source.data : undefined;
};

// 分析经过 Worker 的消息往返，等到不在进行中
async function settled(editor: ScopeEditor): Promise<ScopeAnalysis> {
  await vi.waitFor(() => {
    expect(editor.analysis.value.status).not.toBe('running');
  });
  return editor.analysis.value;
}

describe('范围弹窗的拥有者', () => {
  it('上传文件：分步分析，完成后有分级列表、摘要和人口；名称取文件名，地图移到范围', async () => {
    const { editor, map, defaultViews } = setup();
    editor.start('upload', { files: [geojsonFile('宁镇交界.geojson', NINGZHEN_RINGS)] });
    expect(editor.open.value).toBe(true);
    expect(defaultViews.value).toBe(0);
    expect(editor.busy.value).toBe(true);
    const running = editor.analysis.value;
    expect(running.status === 'running' && running.steps.map(step => step.state)).toEqual([
      'running',
      'waiting',
      'waiting',
      'waiting'
    ]);

    const done = await settled(editor);
    if (done.status !== 'done') {
      throw new Error(`分析没有完成：${done.status}`);
    }
    expect(done.steps.map(step => step.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(done.steps.map(step => step.label)).toEqual(['读取文件：宁镇交界.geojson', '整理范围', '叠加行政区边界', '统计覆盖情况']);
    expect(done.tree.cities.map(city => city.name)).toEqual(['南京市', '镇江市']);
    expect(done.summary).toMatch(/^范围跨南京市、镇江市，/);
    expect(done.population).toBeGreaterThan(0);
    expect(editor.draft.value).toMatchObject({ source: 'upload', file: { name: '宁镇交界.geojson', format: 'geojson' } });
    expect(editor.name.value).toBe('宁镇交界');
    expect(map.cameraRuns.value).toBe(1);
    expect(editor.canConfirm.value).toBe(true);
    expect(editor.canEdit.value).toBe(true);
  });

  it('确定：交出带覆盖分析的范围，关上弹窗并清空；名称去掉首尾空白，空名称不能确定', async () => {
    const { editor, confirmed } = setup();
    editor.start('upload', { files: [geojsonFile('a.geojson', NANJING_RINGS)] });
    await settled(editor);
    editor.setName('   ');
    expect(editor.canConfirm.value).toBe(false);
    editor.confirm();
    expect(confirmed.value).toBeNull();

    editor.setName(' 南京主城 ');
    editor.confirm();
    expect(confirmed.value).toMatchObject({ name: '南京主城', source: 'upload', cityCodes: ['320100'] });
    expect(editor.open.value).toBe(false);
    expect(editor.draft.value).toBeNull();
    expect(editor.analysis.value.status).toBe('empty');
  });

  it('文件不能用：写给用户的话按类型给，具体原因单独留着，不能重试；之前有范围时可以撤销回去', async () => {
    const { editor } = setup();
    editor.start('choose');
    editor.upload([new File(['{"type":'], 'broken.geojson')]);
    const failed = await settled(editor);
    expect(failed).toMatchObject({ status: 'failed', retryable: false, message: '文件无法读取，请检查后重新上传' });
    expect(failed.status === 'failed' && failed.detail?.startsWith('broken.geojson 不是有效的 JSON')).toBe(true);
    expect(editor.canUndo.value).toBe(false);

    editor.upload([geojsonFile('南京.geojson', NANJING_RINGS)]);
    await settled(editor);
    const before = editor.analysis.value;
    // 读不出来的文件不换掉草稿，撤销回到上一个范围的分析
    editor.upload([new File([''], 'empty.geojson')]);
    expect((await settled(editor)).status).toBe('failed');
    expect(editor.draft.value?.file?.name).toBe('南京.geojson');
    editor.undo();
    expect(editor.analysis.value).toBe(before);

    editor.upload([geojsonFile('省外.geojson', [box(116, 30, 116.5, 30.5)])]);
    const outside = await settled(editor);
    expect(outside.status === 'failed' && outside.message).toMatch(/^范围不在江苏省内/);
    // 读得出来的范围仍画在地图上，看得出落在哪里，只是不能确定
    expect(editor.draft.value?.file?.name).toBe('省外.geojson');
    expect(editor.canConfirm.value).toBe(false);
    editor.undo();
    expect(editor.analysis.value).toBe(before);
    expect(editor.draft.value?.file?.name).toBe('南京.geojson');
    expect(editor.canConfirm.value).toBe(true);
  });

  it('区县数据还没加载好时可以重试，重试按上一次的输入再分析', async () => {
    const { editor, model } = setup({ status: 'loading' });
    editor.start('upload', { files: [geojsonFile('南京.geojson', NANJING_RINGS)] });
    const failed = await settled(editor);
    expect(failed).toMatchObject({
      status: 'failed',
      retryable: true,
      message: '区县数据还没有加载好，请稍后重试',
      detail: null
    });

    model.value = { status: 'ready', calculator };
    editor.retry();
    expect((await settled(editor)).status).toBe('done');
  });

  it('新的一次作废还没完成的分析：只留下后上传的结果', async () => {
    const { editor } = setup();
    editor.start('choose');
    editor.upload([geojsonFile('第一个.geojson', NANJING_RINGS)]);
    editor.upload([geojsonFile('第二个.geojson', NINGZHEN_RINGS)]);
    const done = await settled(editor);
    expect(done.status === 'done' && done.tree.cities).toHaveLength(2);
    expect(editor.name.value).toBe('第二个');
    // 第一个还没完成，不算上一个范围
    expect(editor.canUndo.value).toBe(false);
  });

  it('编辑已有的范围：直接用它的分析，不重算；名称保留，默认视角看整个范围', async () => {
    const atlas = await loadTestAtlas();
    const area = await testArea(atlas, NANJING_RINGS, '主城');
    const { editor, map, defaultViews } = setup();
    editor.start('edit', { area });
    expect(editor.analysis.value).toMatchObject({ status: 'done', steps: [], coverage: area.coverage });
    expect(editor.name.value).toBe('主城');
    expect(defaultViews.value).toBe(0);
    editor.overview();
    expect(map.cameraRuns.value).toBe(1);
    editor.focusDistrict('320104');
    expect(map.cameraRuns.value).toBe(2);
    // 没有覆盖的区县不移动
    editor.focusDistrict('321322');
    expect(map.cameraRuns.value).toBe(2);

    // 改过名称后，换了文件也不再自动改
    editor.upload([geojsonFile('新文件.geojson', NINGZHEN_RINGS)]);
    await settled(editor);
    expect(editor.name.value).toBe('主城');
  });

  it('点部分覆盖的区县：移到它在范围内的部分，不是整个区县', async () => {
    const { editor, map } = setup();
    editor.start('upload', { files: [geojsonFile('宁镇.geojson', NINGZHEN_RINGS)] });
    const done = await settled(editor);
    if (done.status !== 'done') {
      throw new Error(`分析没有完成：${done.status}`);
    }
    const partial = required(done.coverage.covers.find(cover => cover.relation === 'partial'), '部分覆盖的区县');
    editor.focusDistrict(partial.code);
    expect(map.fitTargets.value.at(-1)).toEqual(polygonBounds(polygonsOf(partial.geometry)));
    expect(map.fitTargets.value.at(-1)).not.toEqual(calculator.atlas.get(partial.code).bounds);
  });

  it('打开时不定位，等画布放好再 frame：都不带动画，有范围时看范围，没有时看全省', async () => {
    const atlas = await loadTestAtlas();
    const area = await testArea(atlas, NANJING_RINGS, '主城');
    const { editor, map, defaultViews } = setup();
    // 结果阶段的画布还没卸下时不能定位：定位会落在要卸下的画布上
    editor.start('edit', { area });
    expect(map.cameraRuns.value).toBe(0);
    editor.frame();
    expect(map.fitDurations.value).toEqual([0]);
    editor.cancel();

    editor.start('choose');
    expect(map.cameraRuns.value).toBe(1);
    editor.frame();
    expect(map.fitDurations.value).toEqual([0, 0]);
    expect(map.fitTargets.value.at(-1)).toEqual(JIANGSU_BOUNDS);
    expect(defaultViews.value).toBe(0);
  });

  it('上传：还没有范围时直接定位，换范围时平滑移过去', async () => {
    const { editor, map } = setup();
    editor.start('upload', { files: [geojsonFile('南京.geojson', NANJING_RINGS)] });
    await settled(editor);
    expect(map.fitDurations.value).toEqual([0]);

    editor.upload([geojsonFile('宁镇.geojson', NINGZHEN_RINGS)]);
    await settled(editor);
    expect(map.fitDurations.value).toEqual([0, 600]);
  });

  it('清除后可以撤销；取消丢掉草稿并关上弹窗；没有范围时默认视角回到全省', async () => {
    const { editor, defaultViews } = setup();
    editor.start('upload', { files: [geojsonFile('南京.geojson', NANJING_RINGS)] });
    await settled(editor);
    editor.clear();
    expect(editor.draft.value).toBeNull();
    expect(editor.analysis.value.status).toBe('empty');
    editor.overview();
    expect(defaultViews.value).toBe(1);
    editor.undo();
    expect(editor.analysis.value.status).toBe('done');

    editor.cancel();
    expect(editor.open.value).toBe(false);
    expect(editor.draft.value).toBeNull();
    expect(editor.canUndo.value).toBe(false);
  });

  it('打开时要绘制就进入多边形绘制；节点太多的范围不能逐点编辑', async () => {
    const { editor } = setup();
    editor.start('draw');
    expect(editor.draw.active.value).toBe('polygon');

    const ring: Position[] = Array.from({ length: 1200 }, (_, index) => {
      const angle = (index / 1200) * Math.PI * 2;
      return [118.8 + Math.cos(angle) * 0.05, 32 + Math.sin(angle) * 0.05];
    });
    ring.push(ring[0] ?? [0, 0]);
    editor.upload([geojsonFile('圆.geojson', [ring])]);
    expect(editor.draw.active.value).toBeNull();
    await settled(editor);
    expect(editor.draft.value?.vertices).toBeGreaterThan(1000);
    expect(editor.canEdit.value).toBe(false);
  });

  it('样式：弹窗关着时都为空；打开后有区县分界线，完成后有覆盖的部分和范围', async () => {
    const { editor } = setup();
    expect(editor.deriveCover().layers).toEqual([]);
    editor.start('upload', { files: [geojsonFile('南京.geojson', NANJING_RINGS)] });
    expect(editor.deriveCover().layers.map(layer => layer.id)).toEqual(['scope-cover-edge']);
    await settled(editor);
    expect(editor.deriveCover().layers.map(layer => layer.id)).toEqual(['scope-cover-fill', 'scope-cover-edge']);
    expect(editor.deriveArea().layers.map(layer => layer.id)).toContain('scope-area-mask');
    editor.cancel();
    expect(editor.deriveArea().layers).toEqual([]);
  });

  it('悬停：只高亮区县在范围内的部分（不是整个区县）；没有覆盖的区县不高亮；遮罩不随悬停重算', async () => {
    const { editor } = setup();
    editor.start('upload', { files: [geojsonFile('宁镇.geojson', NINGZHEN_RINGS)] });
    const done = await settled(editor);
    if (done.status !== 'done') {
      throw new Error(`分析没有完成：${done.status}`);
    }
    const partial = required(done.coverage.covers.find(cover => cover.relation === 'partial'), '部分覆盖的区县');
    const whole = calculator.atlas.get(partial.code).geometry;
    const before = dataOf(editor.deriveArea(), 'scope-area-mask');
    expect(before).toBeDefined();

    editor.hover(partial.code);
    const group = editor.deriveArea();
    expect(dataOf(group, 'scope-area-hover')).toBe(partial.geometry);
    expect(dataOf(group, 'scope-area-hover')).not.toBe(whole);
    // 同一个对象：会话不重新加载数据源
    expect(dataOf(group, 'scope-area-mask')).toBe(before);
    expect(group.layers.at(-1)?.id).toBe('scope-area-hover-line');

    editor.hover('321322');
    expect(Object.keys(editor.deriveArea().sources)).not.toContain('scope-area-hover');
    editor.hover(null);
    expect(Object.keys(editor.deriveArea().sources)).not.toContain('scope-area-hover');
  });
});
