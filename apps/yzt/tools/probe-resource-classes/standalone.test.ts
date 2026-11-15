// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// 这个目录承诺可以单独拷走用 Node 运行（docs/commands.md、ADR 0137）
// 测试运行时才读目录、起子进程，test:changed 沿 import 关系选不到它，只改 cli.ts 时靠 CI 全量兜底

const root = mkdtempSync(join(tmpdir(), 'probe-standalone-'));
const dir = join(root, 'probe-resource-classes');
cpSync(import.meta.dirname, dir, { recursive: true, filter: source => !source.endsWith('.test.ts') });
const cli = join(dir, 'cli.ts');

function run(...args: string[]) {
  const env = { ...process.env };
  delete env.YZT_PROBE_TOKEN;
  delete env.YZT_PROBE_BASE_URL;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('单独拷走的目录', () => {
  it('只用 Node 就能显示帮助', () => {
    const result = run('--help');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('用法');
  });

  it('指定 --out 时能走到参数检查，不因为找不到模块失败', () => {
    const result = run(`--out=${join(root, 'out')}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('要给出 --base-url');
  });
});
