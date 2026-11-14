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
      roam: false,
      spawnAt: 0,
      routes: [],
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

  it('开关不带值：--no-fit=false 不当成"不拟合"，报错', () => {
    expect(() => parseOptions(['a.lcc2', '--no-fit=false'])).toThrow('不带值');
    expect(() => parseOptions(['--help=0'])).toThrow('不带值');
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

  it('出生点和路线（ADR 0156）：--spawn-at、--route 带上就是 --roam，路线可以写多次', () => {
    expect(parseOptions(['a.lcc2', '--roam'])).toMatchObject({ roam: true, spawnAt: 0, routes: [] });
    const options = parseOptions([
      'a.lcc2',
      '--spawn-at',
      '25',
      '--route',
      'tomb:进墓室:15-250',
      '--route=loop:墓外环路:300.5-460'
    ]);
    expect(options.roam).toBe(true);
    expect(options.spawnAt).toBe(25);
    expect(options.routes).toStrictEqual([
      { id: 'tomb', name: '进墓室', from: 15, to: 250 },
      { id: 'loop', name: '墓外环路', from: 300.5, to: 460 }
    ]);
    expect(() => parseOptions(['a.lcc2', '--route', '进墓室:15-250'])).toThrow('ID:名称:起-止');
    expect(() => parseOptions(['a.lcc2', '--roam=1'])).toThrow('不带值');
  });

  it('--help、-h 不要求索引', () => {
    expect(parseOptions(['--help']).help).toBe(true);
    expect(parseOptions(['-h']).help).toBe(true);
  });
});
