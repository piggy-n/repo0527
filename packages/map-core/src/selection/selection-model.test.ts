// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { type SelectedFeature, SelectionModel } from './selection-model';

const PADDY: SelectedFeature = { sourceId: 'resources-bgdc_dltb', featureId: '1e6325bc5c544dc4b845cdd328d2599c' };
const RIVER: SelectedFeature = { sourceId: 'resources-csxhjctb_hydl', featureId: '9c38b5077eb04f4bb327914b448262ad' };

describe('SelectionModel', () => {
  it('整体替换并发出变化；复制后冻结，调用方之后改自己的对象不影响会话', () => {
    using selection = new SelectionModel();
    const changes: (readonly SelectedFeature[])[] = [];
    selection.on('change', features => changes.push(features));
    const input = [{ ...PADDY }];

    selection.set(input);
    input[0] = RIVER;

    expect(selection.current).toStrictEqual([PADDY]);
    expect(Object.isFrozen(selection.current)).toBe(true);
    expect(Object.isFrozen(selection.current[0])).toBe(true);
    expect(changes).toStrictEqual([[PADDY]]);
    expect(changes[0]).toBe(selection.current);
  });

  it('内容相同时不发事件；顺序不同算变化；清除后是空的', () => {
    using selection = new SelectionModel();
    const onChange = vi.fn<(features: readonly SelectedFeature[]) => void>();
    selection.set([PADDY, RIVER]);
    selection.on('change', onChange);

    selection.set([{ ...PADDY }, { ...RIVER }]);
    expect(onChange).not.toHaveBeenCalled();

    selection.set([RIVER, PADDY]);
    selection.clear();
    selection.clear();
    expect(onChange.mock.calls).toStrictEqual([[[RIVER, PADDY]], [[]]]);
    expect(selection.current).toStrictEqual([]);
  });

  it('同一个要素出现两次时抛错，选择不变', () => {
    using selection = new SelectionModel();
    selection.set([RIVER]);

    expect(() => selection.set([PADDY, { ...PADDY }])).toThrow('选中的要素有重复');
    expect(selection.current).toStrictEqual([RIVER]);
  });

  it('释放后写入和订阅都抛错', () => {
    const selection = new SelectionModel();
    selection[Symbol.dispose]();

    expect(() => selection.set([PADDY])).toThrow('SelectionModel 已释放');
    expect(() => selection.clear()).toThrow('SelectionModel 已释放');
    expect(() => selection.on('change', () => {})).toThrow('SelectionModel 已释放');
  });
});
