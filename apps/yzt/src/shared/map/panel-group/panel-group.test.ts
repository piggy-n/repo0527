// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { closePanel, emptyPanelGroup, selectPanel, showPanel, togglePanel, visibleSides } from './panel-group';
import { usePanelGroup } from './usePanelGroup';

const ORDER = ['region', 'coordinate', 'detail'] as const;
type Id = (typeof ORDER)[number];

describe('showPanel / closePanel / togglePanel', () => {
  it('从入口打开的功能移到最前，并成为当前的', () => {
    let state = emptyPanelGroup<Id>();
    state = showPanel(state, 'detail', ORDER);
    state = showPanel(state, 'region', ORDER);

    expect(state.open).toStrictEqual(['region', 'detail']);
    expect(state.current).toBe('region');
    state = showPanel(state, 'detail', ORDER);
    expect(state.open).toStrictEqual(['detail', 'region']);
  });

  it('直接点 Tab 只切换，不改变顺序；已在显示时原样返回', () => {
    const opened = showPanel(showPanel(emptyPanelGroup<Id>(), 'region', ORDER), 'detail', ORDER);
    const switched = selectPanel(opened, 'region');

    expect(switched.open).toBe(opened.open);
    expect(switched.current).toBe('region');
    expect(selectPanel(switched, 'region')).toBe(switched);
  });

  it('关掉当前的时切到最近显示过的另一个，不是按 Tab 的顺序', () => {
    let state = emptyPanelGroup<Id>();
    state = showPanel(state, 'region', ORDER);
    state = showPanel(state, 'detail', ORDER);
    state = showPanel(state, 'coordinate', ORDER);

    state = closePanel(state, 'coordinate');
    expect(state.current).toBe('detail');
    expect(state.open).toStrictEqual(['detail', 'region']);

    state = closePanel(state, 'detail');
    expect(state.current).toBe('region');

    state = closePanel(state, 'region');
    expect(state).toStrictEqual({ open: [], current: null, recent: [] });
  });

  it('关掉没在显示的功能时当前的不变；关没打开的原样返回', () => {
    const state = showPanel(showPanel(emptyPanelGroup<Id>(), 'region', ORDER), 'detail', ORDER);
    const closed = closePanel(state, 'region');

    expect(closed.current).toBe('detail');
    expect(closed.open).toStrictEqual(['detail']);
    expect(closePanel(closed, 'coordinate')).toBe(closed);
  });

  it('入口的点击：没打开时打开，打开了但没在显示时切到它，正在显示时关闭', () => {
    let state = togglePanel(emptyPanelGroup<Id>(), 'region', ORDER, false);
    expect(state.current).toBe('region');

    state = togglePanel(state, 'coordinate', ORDER, true);
    expect(state.current).toBe('coordinate');

    state = togglePanel(state, 'region', ORDER, true);
    expect(state.current).toBe('region');
    expect(state.open).toStrictEqual(['region', 'coordinate']);

    state = togglePanel(state, 'region', ORDER, true);
    expect(state.open).toStrictEqual(['coordinate']);
    expect(state.current).toBe('coordinate');
  });

  it('整组被隐藏（窄屏时让给了另一边）时点正在显示的入口：不关闭，原样返回（2026-10-16 评审发现）', () => {
    const state = showPanel(showPanel(emptyPanelGroup<Id>(), 'region', ORDER), 'coordinate', ORDER);

    expect(togglePanel(state, 'coordinate', ORDER, false)).toBe(state);
    expect(togglePanel(state, 'region', ORDER, false).current).toBe('region');
  });
});

describe('usePanelGroup', () => {
  it('统一关闭清空当前、已打开和历史；再次关闭不替换状态', () => {
    const group = usePanelGroup(ORDER);
    group.show('region');
    group.show('detail');
    group.closeAll();
    expect(group.state.value).toStrictEqual(emptyPanelGroup());
    const before = group.state.value;
    group.closeAll();
    expect(group.state.value).toBe(before);
  });

  it('按规则打开、切换、关闭；没有改变时不替换状态', () => {
    const group = usePanelGroup(ORDER);
    group.toggle('region', true);
    group.show('detail');

    expect(group.isOpen('region')).toBe(true);
    expect(group.state.value.current).toBe('detail');

    const before = group.state.value;
    group.show('detail');
    group.close('coordinate');
    expect(group.state.value).toBe(before);

    group.close('detail');
    expect(group.state.value.current).toBe('region');
  });

  it('不在这组里的功能直接抛错，状态不变', () => {
    const group = usePanelGroup(ORDER);
    const before = group.state.value;

    // @ts-expect-error 测试运行时的检查
    expect(() => group.show('legend')).toThrow(RangeError);
    expect(group.state.value).toBe(before);
  });
});

describe('visibleSides', () => {
  it('宽屏时两边按各自的状态显示', () => {
    expect(visibleSides({ narrow: false, leftExpanded: true, rightOpen: true, lastSide: 'left' })).toStrictEqual({
      left: true,
      right: true
    });
  });

  it('窄屏且两边都有东西要显示时，只显示最后操作的一边', () => {
    expect(visibleSides({ narrow: true, leftExpanded: true, rightOpen: true, lastSide: 'left' })).toStrictEqual({
      left: true,
      right: false
    });
    expect(visibleSides({ narrow: true, leftExpanded: true, rightOpen: true, lastSide: 'right' })).toStrictEqual({
      left: false,
      right: true
    });
  });

  it('窄屏时只有一边有东西要显示，就显示这一边，不看最后操作的是哪边', () => {
    expect(visibleSides({ narrow: true, leftExpanded: true, rightOpen: false, lastSide: 'right' })).toStrictEqual({
      left: true,
      right: false
    });
    expect(visibleSides({ narrow: true, leftExpanded: false, rightOpen: true, lastSide: 'left' })).toStrictEqual({
      left: false,
      right: true
    });
  });
});
