/** 把分块到达的文本切成整行；不完整的最后一行留到下一块，读完后用 flush 取出 */
export class LineSplitter {
  #rest = '';

  push(chunk: string): string[] {
    const lines = (this.#rest + chunk).split('\n');
    this.#rest = lines.pop() ?? '';
    return lines;
  }

  flush(): string[] {
    const rest = this.#rest;
    this.#rest = '';
    return rest.trim() === '' ? [] : [rest];
  }
}

/** 一行 SSE 里的数据：只认 data: 开头的行，空数据和结束标记 [DONE] 返回 null；沿用旧项目，一行 data 就是一个事件 */
export function sseData(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    return null;
  }
  const data = trimmed.slice('data:'.length).trim();
  return data === '' || data === '[DONE]' ? null : data;
}
