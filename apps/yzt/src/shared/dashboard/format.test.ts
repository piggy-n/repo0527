// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { withUnit } from './format';

describe('withUnit', () => {
  it('有单位时写在全角括号里', () => {
    expect(withUnit('消防救援5分钟可达覆盖率', '%')).toBe('消防救援5分钟可达覆盖率（%）');
  });

  it('单位为空时只写名称', () => {
    expect(withUnit('生活宜居便利性指数', '')).toBe('生活宜居便利性指数');
  });
});
