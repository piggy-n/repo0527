// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { panKeyFor } from './pan-key';

describe('panKeyFor', () => {
  it('Mac、iPhone、iPad 用 ⌘，其他平台用 Ctrl', () => {
    expect(panKeyFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toStrictEqual({
      modifier: 'meta',
      label: '⌘'
    });
    expect(panKeyFor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').modifier).toBe('meta');
    expect(panKeyFor('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)').modifier).toBe('meta');
    expect(panKeyFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toStrictEqual({
      modifier: 'ctrl',
      label: 'Ctrl'
    });
    expect(panKeyFor('Mozilla/5.0 (X11; Linux x86_64)').modifier).toBe('ctrl');
  });
});
