// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { panKeyFor } from '@/shared/map/pan-key';
import { pickHintLines, scenePickHintLines } from './pick-hint';

describe('pickHintLines', () => {
  it('两行：单击和框选、临时拖动和 Esc；修饰键按平台写', () => {
    expect(pickHintLines(panKeyFor('Windows NT 10.0'))).toStrictEqual([
      '单击查看要素，拖动框选',
      '按住 Ctrl 拖动地图，Esc 取消或清除结果'
    ]);
    expect(pickHintLines(panKeyFor('Macintosh; Intel Mac OS X'))[1]).toBe('按住 ⌘ 拖动地图，Esc 取消或清除结果');
  });
});

describe('scenePickHintLines', () => {
  it('三维里两行：不支持点/框选、切回二维和怎样拖动地图；修饰键按平台写', () => {
    expect(scenePickHintLines(panKeyFor('Windows NT 10.0'))).toStrictEqual([
      '三维模式暂不支持点/框选',
      '切换到二维后使用，按住 Ctrl 拖动地图'
    ]);
    expect(scenePickHintLines(panKeyFor('Macintosh; Intel Mac OS X'))[1]).toBe('切换到二维后使用，按住 ⌘ 拖动地图');
  });
});
