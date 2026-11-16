// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseOptions } from './args.ts';

// 高程基准的差必填，和它无关的用例都带上
const DATUM = ['--datum', '0'];

describe('parseOptions', () => {
  it('默认：拟合，不加人工修正', () => {
    expect(parseOptions(['a/b.lcc2', ...DATUM])).toEqual({
      index: 'a/b.lcc2',
      shift: [0, 0, 0],
      yaw: 0,
      datum: 0,
      fit: true,
      roam: false,
      spawnAt: 0,
      routes: [],
      stretches: [],
      diagnose: false,
      plan: null,
      help: false
    });
  });

  it('--straight：按轨迹米数分段的拉直容差，可以写多次，带上它就是 --roam；写错、止不大于起、容差不大于 0 都报错', () => {
    const options = parseOptions(['a.lcc2', ...DATUM, '--straight', '15-50:3', '--straight=545.5-600:2.5']);
    expect(options.roam).toBe(true);
    expect(options.stretches).toStrictEqual([
      { from: 15, to: 50, tolerance: 3 },
      { from: 545.5, to: 600, tolerance: 2.5 }
    ]);
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--straight', '15-50'])).toThrow('起-止:容差');
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--straight', '50-15:3'])).toThrow('止要大于起');
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--straight', '15-50:0'])).toThrow('容差要大于 0');
  });

  it('--diagnose：逐个列出拉直留下的拐点，带上它就是 --roam，不带值', () => {
    expect(parseOptions(['a.lcc2', ...DATUM, '--diagnose'])).toMatchObject({ diagnose: true, roam: true });
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--diagnose=1'])).toThrow('不带值');
  });

  it('--plan：平面图写到一个 .svg 文件，带上它就是 --roam；忘了写值、不是 .svg 都报错', () => {
    const options = parseOptions(['a.lcc2', ...DATUM, '--plan', 'lcc2-plan/a.svg']);
    expect(options).toMatchObject({ plan: 'lcc2-plan/a.svg', roam: true });
    expect(parseOptions(['a.lcc2', ...DATUM, '--plan=C:/x/A.SVG']).plan).toBe('C:/x/A.SVG');
    // 忘了写值时下一个参数被当成文件名
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--plan', '--roam'])).toThrow('.svg 文件：--roam');
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--plan', 'a.png'])).toThrow('.svg 文件');
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--plan'])).toThrow('缺少值');
  });

  it('--datum 必填：漏写时报错、不按 0 算，没有量出差值的数据显式写 0', () => {
    expect(() => parseOptions(['a.lcc2'])).toThrow('要写 --datum');
    expect(() => parseOptions(['a.lcc2', '--roam', '--shift', '0,0,1'])).toThrow('要写 --datum');
    expect(parseOptions(['a.lcc2', '--datum', '0']).datum).toBe(0);
    expect(parseOptions(['--datum=5.47', 'a.lcc2']).datum).toBe(5.47);
  });

  it('pnpm 传进来的 -- 跳过', () => {
    expect(parseOptions(['--', 'a.lcc2', ...DATUM]).index).toBe('a.lcc2');
  });

  it('人工修正：负数是值不是选项，也可以写在等号后面', () => {
    const options = parseOptions(['a.lcc2', '--shift', '-1.5,2,-0.25', '--yaw=-0.3', '--datum', '-5.47']);
    expect(options.shift).toEqual([-1.5, 2, -0.25]);
    expect(options.yaw).toBe(-0.3);
    expect(options.datum).toBe(-5.47);
  });

  it('PowerShell 把没加引号的逗号列表传成空格分隔：一样能读', () => {
    expect(parseOptions(['a.lcc2', '--shift', '1 2 3', ...DATUM]).shift).toEqual([1, 2, 3]);
  });

  it('--no-fit：不拟合', () => {
    expect(parseOptions(['--no-fit', 'a.lcc2', ...DATUM]).fit).toBe(false);
  });

  it('开关不带值：--no-fit=false 不当成"不拟合"，报错', () => {
    expect(() => parseOptions(['a.lcc2', '--no-fit=false', ...DATUM])).toThrow('不带值');
    expect(() => parseOptions(['--help=0'])).toThrow('不带值');
  });

  it('写错的值报错', () => {
    expect(() => parseOptions(['a.lcc2', '--shift', '1,2', ...DATUM])).toThrow('--shift');
    expect(() => parseOptions(['a.lcc2', '--yaw', 'abc', ...DATUM])).toThrow('--yaw');
    expect(() => parseOptions(['a.lcc2', '--datum='])).toThrow('--datum 要是数');
    expect(() => parseOptions(['a.lcc2', '--datum'])).toThrow('缺少值');
  });

  it('索引要给且只给一个，不认识的选项报错', () => {
    expect(() => parseOptions(DATUM)).toThrow('0 个');
    expect(() => parseOptions(['a.lcc2', 'b.lcc2', ...DATUM])).toThrow('2 个');
    expect(() => parseOptions(['a.lcc2', '--fit', ...DATUM])).toThrow('不认识');
  });

  it('出生点和路线（ADR 0156）：--spawn-at、--route 带上就是 --roam，路线可以写多次', () => {
    expect(parseOptions(['a.lcc2', '--roam', ...DATUM])).toMatchObject({ roam: true, spawnAt: 0, routes: [] });
    const options = parseOptions([
      'a.lcc2',
      ...DATUM,
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
    expect(() => parseOptions(['a.lcc2', '--route', '进墓室:15-250', ...DATUM])).toThrow('ID:名称:起-止');
    // 第四段是拉直的水平容差
    expect(parseOptions(['a.lcc2', ...DATUM, '--route', 'hall:进厅:25-75:3']).routes).toStrictEqual([
      { id: 'hall', name: '进厅', from: 25, to: 75, tolerance: 3 }
    ]);
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--route', 'hall:进厅:25-75:0'])).toThrow('容差要大于 0');
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--route', 'hall:进厅:25-75:'])).toThrow('ID:名称:起-止');
    // 同一模型的路线 ID 重复时清单校验不过，在读模型之前就拒绝
    expect(() =>
      parseOptions(['a.lcc2', ...DATUM, '--route', 'tomb:进墓室:100-280', '--route=tomb:出墓室:300-400'])
    ).toThrow('ID 重复：tomb');
    expect(() => parseOptions(['a.lcc2', ...DATUM, '--route', 'tomb:进墓室:1-2', '--route', 'tomb:进墓室:1-2'])).toThrow(
      'ID 重复：tomb'
    );
    expect(() => parseOptions(['a.lcc2', '--roam=1', ...DATUM])).toThrow('不带值');
  });

  it('--help、-h 不要求索引，也不要求 --datum', () => {
    expect(parseOptions(['--help']).help).toBe(true);
    expect(parseOptions(['-h']).help).toBe(true);
  });
});
