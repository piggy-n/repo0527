// @vitest-environment node
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createRedactor } from './redact.ts';

describe('createRedactor', () => {
  const redact = createRedactor('C:/repo', { username: 'alice', machine: 'desk-01' });

  it('去掉用户名、主机名和仓库路径', () => {
    expect(redact('用户 alice 在 desk-01 上跑 C:\\repo\\apps')).toBe('用户 <用户> 在 <主机> 上跑 <仓库>\\apps');
  });

  it('去掉用户目录和 key', () => {
    expect(redact(`${homedir()}/a?tk=secret`)).toBe('<用户目录>/a?tk=***');
  });

  it('用户名全是数字时不替换：结果里到处是数字，替换了 raw.json 就坏了', () => {
    const numeric = createRedactor('C:/repo', { username: '2333', machine: '4567' });
    const json = JSON.stringify({ t: 2333.2, triangles: 2333, id: 4567 });
    expect(numeric(json)).toBe(json);
  });

  it('用户名全是数字时，用户目录照样去掉', () => {
    const numeric = createRedactor('C:/repo', { username: '2333', machine: 'desk-01' });
    expect(numeric(`${homedir()}/x`)).toBe('<用户目录>/x');
  });

  it('太短的名字不替换', () => {
    const short = createRedactor('C:/repo', { username: 'ab', machine: 'cd' });
    expect(short('ab cd')).toBe('ab cd');
  });

  it('不给名字时用这台机器的', () => {
    expect(createRedactor('C:/repo')('C:/repo/x')).toBe('<仓库>/x');
  });
});
