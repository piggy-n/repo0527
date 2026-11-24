import { describe, expect, it } from 'vitest';
import type { SceneModel } from './catalog';
import { modelPrintBlock, printedModels } from './print-legend';
import type { ModelLoadState } from './scene-content';

// 只用到 id、名称和种类
const model = (id: string, name: string, kind: SceneModel['kind']) => ({ id, name, kind }) as SceneModel;

const MODELS = [
  model('jn', '江宁片区', 'oblique'),
  model('xz', '徐州站', 'indoor'),
  model('gs', '龟山汉墓', 'splat'),
  model('bm', '新城白膜', 'white')
];

describe('printedModels', () => {
  it('加入了、没隐藏、没加载失败的模型，次序同图层；还在加载的也列', () => {
    const states: Readonly<Record<string, ModelLoadState>> = { jn: 'ready', xz: 'failed', gs: 'loading', bm: 'ready' };

    const added = ['gs', 'bm', 'xz', 'jn', 'gone'];
    const printed = printedModels(MODELS, added, new Set(['bm']), id => states[id] ?? 'loading');

    expect(printed.map(item => item.id)).toStrictEqual(['gs', 'jn']);
  });
});

describe('modelPrintBlock', () => {
  it('一组"三维模型"，名称后面是种类；没有模型时没有', () => {
    const block = modelPrintBlock([MODELS[0], MODELS[2]].filter(item => item !== undefined));

    expect(block?.title).toBe('三维模型');
    expect(block?.rows.map(row => row.label)).toStrictEqual(['江宁片区（倾斜摄影）', '龟山汉墓（高斯泼溅）']);
    expect(modelPrintBlock([])).toBeNull();
  });
});
