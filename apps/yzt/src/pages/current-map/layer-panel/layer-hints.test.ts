// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAYER_HINTS } from '@/shared/config/layer-hints';
import { requestKindsOf, resourceStatusKindsOf } from './layer-hints';

describe('行内提示的开关落到哪里（ADR 0167）', () => {
  it('数据加载按前三类；资源的状态图标里瓦片失败跟着加载失败', () => {
    const shown = new Set(['loading', 'minzoom'] as const);
    expect(requestKindsOf(shown)).toStrictEqual({ loading: true, failed: false, done: false });
    expect(resourceStatusKindsOf(shown)).toStrictEqual(['minzoom']);
    expect(requestKindsOf(new Set(LAYER_HINTS))).toStrictEqual({ loading: true, failed: true, done: true });
    expect(resourceStatusKindsOf(new Set(LAYER_HINTS))).toStrictEqual(['config-error', 'tile-error', 'minzoom']);
  });
});
