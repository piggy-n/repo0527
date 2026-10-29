// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LineSplitter, sseData } from './sse';

describe('LineSplitter', () => {
  it('跨块的行拼完整后才交出，最后一行留到 flush', () => {
    const splitter = new LineSplitter();

    expect(splitter.push('data: {"a"')).toEqual([]);
    expect(splitter.push(':1}\ndata: {"b":2}\r\ndata: {"c"')).toEqual(['data: {"a":1}', 'data: {"b":2}\r']);
    expect(splitter.push(':3}')).toEqual([]);
    expect(splitter.flush()).toEqual(['data: {"c":3}']);
    expect(splitter.flush()).toEqual([]);
  });

  it('只剩空白时 flush 不交出空行', () => {
    const splitter = new LineSplitter();

    splitter.push('data: 1\n  ');

    expect(splitter.flush()).toEqual([]);
  });
});

describe('sseData', () => {
  it('取出 data: 后面的内容', () => {
    expect(sseData('data: {"type":"token"}\r')).toBe('{"type":"token"}');
    expect(sseData('data:{"type":"done"}')).toBe('{"type":"done"}');
  });

  it('其他字段、空数据和结束标记都不是事件', () => {
    expect(sseData('event: message')).toBeNull();
    expect(sseData(': 心跳')).toBeNull();
    expect(sseData('')).toBeNull();
    expect(sseData('data:   ')).toBeNull();
    expect(sseData('data: [DONE]')).toBeNull();
  });
});
