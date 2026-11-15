// @vitest-environment node
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createRedactor, stringifyRedacted } from './redact.ts';

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

  it('Linux 的绝对路径连开头的斜杠一起去掉', () => {
    const posix = createRedactor('/home/runner/work/repo', { username: 'alice', machine: 'desk-01' });
    expect(posix('打开 /home/runner/work/repo/x 和 \\/home\\/runner\\/work\\/repo\\/y')).toBe('打开 <仓库>/x 和 <仓库>\\/y');
  });

  it('不给名字时用这台机器的', () => {
    expect(createRedactor('C:/repo')('C:/repo/x')).toBe('<仓库>/x');
  });
});

describe('stringifyRedacted', () => {
  const sample = { finished: false, stable: true, gpu: null, fps: [60, null] };

  it.each(['true', 'false', 'null', 'TRUE', 'False', 'NULL'])('主机名是 %s 时 JSON 照样合法，只替换字符串里的', machine => {
    const redact = createRedactor('C:/repo', { username: 'alice', machine });
    const text = stringifyRedacted({ ...sample, note: `在 ${machine} 上跑` }, redact);
    expect(() => {
      JSON.parse(text);
    }).not.toThrow();
    expect(JSON.parse(text)).toEqual({ ...sample, note: '在 <主机> 上跑' });
  });

  it('主机名和键名相同时键名不变', () => {
    const redact = createRedactor('C:/repo', { username: 'alice', machine: 'stable' });
    expect(JSON.parse(stringifyRedacted({ stable: true, note: 'stable' }, redact))).toEqual({
      stable: true,
      note: '<主机>'
    });
  });

  it('字符串里的 Windows 路径、key 和主机名照样去掉，数字原样保留', () => {
    const redact = createRedactor('C:\\repo', { username: '2333', machine: 'desk-01' });
    const value = { url: 'C:\\repo\\local\\a.glb?tk=secret', t: 2333.2, nested: [{ who: 'desk-01' }] };
    expect(JSON.parse(stringifyRedacted(value, redact, 1))).toEqual({
      url: '<仓库>\\local\\a.glb?tk=***',
      t: 2333.2,
      nested: [{ who: '<主机>' }]
    });
  });
});
