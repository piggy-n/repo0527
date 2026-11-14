// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors.ts';
import { writePlan } from './plan-file.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lcc2-plan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// 抛出来的错误，没抛时报出来
async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('没有抛错');
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : '');
// 原来的文件错误的错误码
const causeCode = (error: unknown) =>
  error instanceof Error && error.cause instanceof Error && 'code' in error.cause ? String(error.cause.code) : '';

describe('writePlan', () => {
  it('相对路径写在 localRoot 下，目录没有就建；绝对路径原样；返回写到的文件', async () => {
    const relative = await writePlan('lcc2-plan/a.svg', '<svg/>', root);
    expect(relative).toBe(join(root, 'lcc2-plan', 'a.svg'));
    expect(readFileSync(relative, 'utf8')).toBe('<svg/>');
    const elsewhere = join(root, 'other', 'b.svg');
    expect(await writePlan(elsewhere, '<svg>b</svg>', join(root, 'unused'))).toBe(elsewhere);
    expect(readFileSync(elsewhere, 'utf8')).toBe('<svg>b</svg>');
    // 再写一次是覆盖
    await writePlan('lcc2-plan/a.svg', '<svg>2</svg>', root);
    expect(readFileSync(relative, 'utf8')).toBe('<svg>2</svg>');
  });

  it('目标是目录、上一级是文件：只报一行原因的 ToolError，带路径和错误码，原来的错误留在 cause', async () => {
    mkdirSync(join(root, 'dir.svg'));
    const isDirectory = await failure(() => writePlan('dir.svg', '<svg/>', root));
    expect(isDirectory).toBeInstanceOf(ToolError);
    expect(messageOf(isDirectory)).toContain(`写不了平面图 ${join(root, 'dir.svg')}：`);
    expect(messageOf(isDirectory)).toMatch(/：(这是目录|E[A-Z]+)$/);
    expect(causeCode(isDirectory)).toMatch(/^E[A-Z]+$/);

    writeFileSync(join(root, 'file'), '');
    const underFile = await failure(() => writePlan('file/a.svg', '<svg/>', root));
    expect(underFile).toBeInstanceOf(ToolError);
    expect(messageOf(underFile)).toMatch(/写不了平面图 .*a\.svg：E[A-Z]+$/);
  });
});
