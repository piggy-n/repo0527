// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseOptions } from './args.ts';

describe('parseOptions', () => {
  it('默认：拟合，不加人工修正', () => {
    expect(parseOptions(['a/b.lcc2'])).toEqual({
      index: 'a/b.lcc2',
      shift: [0, 0, 0],
      yaw: 0,
      datum: 0,
      fit: true,
      help: false
    });
  });

  it('pnpm 传进来的 -- 跳过', () => {
    expect(parseOptions(['--', 'a.lcc2']).index).toBe('a.lcc2');
  });

  it('人工修正：负数是值不是选项，也可以写在等号后面', () => {
    const options = parseOptions(['a.lcc2', '--shift', '-1.5,2,-0.25', '--yaw=-0.3', '--datum', '5.47']);
    expect(options.shift).toEqual([-1.5, 2, -0.25]);
    expect(options.yaw).toBe(-0.3);
    expect(options.datum).toBe(5.47);
  });

  it('PowerShell 把没加引号的逗号列表传成空格分隔：一样能读', () => {
    expect(parseOptions(['a.lcc2', '--shift', '1 2 3']).shift).toEqual([1, 2, 3]);
  });

  it('--no-fit：不拟合', () => {
    expect(parseOptions(['--no-fit', 'a.lcc2']).fit).toBe(false);
  });

  it('写错的值报错', () => {
    expect(() => parseOptions(['a.lcc2', '--shift', '1,2'])).toThrow('--shift');
    expect(() => parseOptions(['a.lcc2', '--yaw', 'abc'])).toThrow('--yaw');
    expect(() => parseOptions(['a.lcc2', '--datum='])).toThrow('--datum');
    expect(() => parseOptions(['a.lcc2', '--datum'])).toThrow('缺少值');
  });

  it('索引要给且只给一个，不认识的选项报错', () => {
    expect(() => parseOptions([])).toThrow('0 个');
    expect(() => parseOptions(['a.lcc2', 'b.lcc2'])).toThrow('2 个');
    expect(() => parseOptions(['a.lcc2', '--fit'])).toThrow('不认识');
  });

  it('--help 不要求索引', () => {
    expect(parseOptions(['--help']).help).toBe(true);
  });
});
