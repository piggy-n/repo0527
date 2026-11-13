// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseOptions, uploadBudgets } from './options.ts';

describe('parseOptions', () => {
  it('默认：3 遍，对照不提前上传，带底图', () => {
    const options = parseOptions([]);
    expect(options.repeat).toBe(3);
    expect(uploadBudgets(options)).toEqual([null]);
    expect(options.basemap).toBe('arcgis');
    expect(options.pacing).toBe(2);
  });

  it('--look 时没写 --upload-mb 不对照上传预算，写了照写的', () => {
    expect(uploadBudgets(parseOptions(['--look']))).toEqual([]);
    expect(uploadBudgets(parseOptions(['--look', '--upload-mb', 'off']))).toEqual([null]);
    expect(uploadBudgets(parseOptions(['--upload-mb', 'none']))).toEqual([]);
  });

  it('--at：经,纬,级别,俯角,方位，空格分隔也认；范围不对的报错', () => {
    expect(parseOptions([]).at).toBeNull();
    expect(parseOptions(['--at', '120.41234,31.51234,17.2,55,20']).at).toEqual({ center: [120.41234, 31.51234], zoom: 17.2, pitch: 55, bearing: 20 });
    expect(parseOptions(['--at', '120.4 31.5 17 0 -30']).at).toEqual({ center: [120.4, 31.5], zoom: 17, pitch: 0, bearing: -30 });
    expect(() => parseOptions(['--at', '120.4,31.5,17,55'])).toThrow('--at');
    expect(() => parseOptions(['--at', '31.5,120.4,17,55,20'])).toThrow('--at');
    expect(() => parseOptions(['--at', '120.4,31.5,17,90,20'])).toThrow('--at');
    expect(() => parseOptions(['--at', '120.4,31.5,x,55,20'])).toThrow('--at');
  });

  it('pnpm 传进来的 -- 跳过', () => {
    expect(parseOptions(['--', '--only', 'z19']).only).toEqual(['z19']);
  });

  it('上传预算：off 是不提前上传', () => {
    expect(parseOptions(['--upload-mb', 'off,16,64']).uploadMBs).toEqual([null, 16, 64]);
  });

  it('PowerShell 把没加引号的逗号列表传成空格分隔：上传预算一样能读', () => {
    expect(parseOptions(['--upload-mb', 'off 16']).uploadMBs).toEqual([null, 16]);
  });

  it('上传预算写 none：不对照上传预算', () => {
    expect(parseOptions(['--upload-mb', 'none']).uploadMBs).toEqual([]);
  });

  it('动着不请求的窗口：默认不对照，off 是动着也请求，auto 按实测的加载时间', () => {
    expect(parseOptions([]).cullWindows).toEqual([]);
    expect(parseOptions(['--cull-window', 'off,0.3,0.5']).cullWindows).toEqual([null, 0.3, 0.5]);
    expect(parseOptions(['--cull-window', '1,auto']).cullWindows).toEqual([1, 'auto']);
    expect(parseOptions(['--cull-window', 'off 0.3']).cullWindows).toEqual([null, 0.3]);
    expect(() => parseOptions(['--cull-window', '0'])).toThrow('--cull-window');
  });

  it('缓存上限：默认不对照，逗号或空格分隔，重复的只留一个，要是正数', () => {
    expect(parseOptions([]).cacheGBs).toEqual([]);
    expect(parseOptions(['--cache-gb', '4,6']).cacheGBs).toEqual([4, 6]);
    expect(parseOptions(['--cache-gb', '3 4 4']).cacheGBs).toEqual([3, 4]);
    expect(parseOptions(['--cache-gb', '1.5']).cacheGBs).toEqual([1.5]);
    expect(() => parseOptions(['--cache-gb', '0'])).toThrow('--cache-gb');
    expect(() => parseOptions(['--cache-gb', 'big'])).toThrow('--cache-gb');
  });

  it('设备档位：默认不对照，逗号或空格分隔，重复的只留一个，只认三档', () => {
    expect(parseOptions([]).tiers).toEqual([]);
    expect(parseOptions(['--tier', 'low,high']).tiers).toEqual(['low', 'high']);
    expect(parseOptions(['--tier', 'high high standard']).tiers).toEqual(['high', 'standard']);
    expect(() => parseOptions(['--tier', 'ultra'])).toThrow('--tier');
  });

  it('上传后释放贴图的对照、定位后放大一级：默认不加', () => {
    expect(parseOptions([]).keepImages).toBe(false);
    expect(parseOptions(['--keep-images']).keepImages).toBe(true);
    expect(parseOptions([]).zoomIn).toBe(false);
    expect(parseOptions(['--zoom-in']).zoomIn).toBe(true);
  });

  it('泼溅的预算：默认 300 万、600 万、1000 万，3m、3e6、3000000 都认，重复的只留一个', () => {
    expect(parseOptions([]).splatBudgets).toEqual([3_000_000, 6_000_000, 10_000_000]);
    expect(parseOptions(['--splat-budget', '3m,6e6 10000000']).splatBudgets).toEqual([3_000_000, 6_000_000, 10_000_000]);
    expect(parseOptions(['--splat-budget', '1.5m,1500000']).splatBudgets).toEqual([1_500_000]);
    expect(parseOptions(['--splat-budget', '4.1m']).splatBudgets).toEqual([4_100_000]);
    expect(() => parseOptions(['--splat-budget', ','])).toThrow('至少写一个预算');
    expect(() => parseOptions(['--splat-budget', '0'])).toThrow('--splat-budget');
    expect(() => parseOptions(['--splat-budget', '3.5'])).toThrow('--splat-budget');
    expect(() => parseOptions(['--splat-budget', '3k'])).toThrow('--splat-budget');
  });

  it('帧率上限：默认不封顶', () => {
    expect(parseOptions([]).fps).toBeNull();
    expect(parseOptions(['--fps', '60']).fps).toBe(60);
    expect(() => parseOptions(['--fps', '0'])).toThrow('--fps');
  });

  it('PowerShell 把没加引号的逗号列表传成空格分隔：场景一样能读', () => {
    expect(parseOptions(['--only', 'z17 z19']).only).toEqual(['z17', 'z19']);
  });

  it('视口、在路上的帧数', () => {
    const options = parseOptions(['--viewport', '1920x1080', '--pacing', '0']);
    expect(options.viewport).toEqual({ width: 1920, height: 1080 });
    expect(options.pacing).toBe(0);
  });

  it.each([
    [['--nope'], '不认识的参数'],
    [['--repeat'], '后面要写一个值'],
    [['--repeat', '0'], '要是正数'],
    [['--basemap', 'osm'], '只能是'],
    [['--viewport', '1600'], '宽x高'],
    [['--pacing', '-1'], '不小于 0']
  ])('不合法的参数说清楚：%j', (argv, message) => {
    expect(() => parseOptions(argv)).toThrow(message);
  });
});
