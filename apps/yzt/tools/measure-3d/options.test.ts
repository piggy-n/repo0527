// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseOptions } from './options.ts';

describe('parseOptions', () => {
  it('默认：3 遍，对照不提前上传，带底图', () => {
    const options = parseOptions([]);
    expect(options.repeat).toBe(3);
    expect(options.uploadMBs).toEqual([null]);
    expect(options.basemap).toBe('arcgis');
    expect(options.pacing).toBe(2);
  });

  it('pnpm 传进来的 -- 跳过', () => {
    expect(parseOptions(['--', '--only', 'z19']).only).toEqual(['z19']);
  });

  it('上传预算：off 是不提前上传', () => {
    expect(parseOptions(['--upload-mb', 'off,16,64']).uploadMBs).toEqual([null, 16, 64]);
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
