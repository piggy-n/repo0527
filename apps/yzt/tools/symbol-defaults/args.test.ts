// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCommand } from './args.ts';

describe('symbols:import 的参数', () => {
  it('导出文件必填；不加 --write 时只预览', () => {
    const file = 'local/symbol-defaults/a.json';
    expect(parseCommand([file])).toStrictEqual({ file, write: false });
    expect(() => parseCommand([])).toThrow('要给出一个导出文件');
    expect(() => parseCommand(['a.json', 'b.json'])).toThrow('要给出一个导出文件');
    expect(parseCommand(['--help'])).toBeNull();
  });

  it('--only 按半角或全角逗号分开、去掉空白；空的 --only 报错；不认识的参数报错', () => {
    expect(parseCommand(['a.json', '--only', ' szy_kt，bgdc_dltb, ', '--login', '张三', '--write'])).toStrictEqual({
      file: 'a.json',
      write: true,
      login: '张三',
      only: ['szy_kt', 'bgdc_dltb']
    });
    expect(() => parseCommand(['a.json', '--only', ' , '])).toThrow('--only 后面要写资源的 code');
    expect(() => parseCommand(['a.json', '--force'])).toThrow("Unknown option '--force'");
  });
});
