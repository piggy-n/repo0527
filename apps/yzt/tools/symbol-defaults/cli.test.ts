// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 独立进程不继承 Vitest 的别名配置；test:changed 沿 import 关系选不到 CLI，修改入口时要显式运行本用例
describe('symbols:import 的命令行入口', () => {
  it('独立 Node 进程能解析应用别名并完成只读预览', () => {
    const directory = mkdtempSync(join(tmpdir(), 'symbol-defaults-cli-'));
    const file = join(directory, 'export.json');
    const appDir = resolve(import.meta.dirname, '../..');
    const defaultsFile = join(appDir, 'src/features/resource-map/resource-symbol-defaults.json');
    const before = readFileSync(defaultsFile, 'utf8');
    writeFileSync(
      file,
      JSON.stringify({
        kind: 'yzt-resource-symbols',
        exportedAt: '2026-11-19T00:00:00.000Z',
        entries: [{ key: 'cli-test/resource-symbols', record: { version: 1, value: {} } }]
      })
    );

    try {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), file], {
        cwd: appDir,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true
      });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('账号 cli-test');
      expect(result.stdout).toContain('和现在的发布默认符号相同，没有变化');
      expect(readFileSync(defaultsFile, 'utf8')).toBe(before);
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
});
