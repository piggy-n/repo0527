// 只供测试使用：在内存里拼第一代紧凑缓存的 .bundlx、.bundle，按 HTTP 的规矩（整份 200、Range 206、没有 404）回答
// 槽号和文件名在这里按格式另写一遍，不用被测的 compactTileLocation，按行存、按列存弄反时测试才会失败

const PACKET = 128;
const DATA_START = 60 + PACKET * PACKET * 4;

/** bundle 里的一块瓦片：列、行是 bundle 内的位置（0～127） */
export interface FixtureRecord {
  readonly column: number;
  readonly row: number;
  readonly data: Uint8Array;
  /** 写进记录的长度，默认是 data 的长度；用来造长度不对的记录 */
  readonly length?: number;
}

export interface FixtureBundle {
  readonly index: Uint8Array<ArrayBuffer>;
  readonly data: Uint8Array<ArrayBuffer>;
  /** 这块瓦片的记录在 .bundle 里的偏移 */
  offsetOf(column: number, row: number): number;
}

/** 最小的 JPEG、PNG 开头：读取器只看开头的字节 */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

/** 一块可以区分的"JPEG"：开头是 JPEG 的魔数，后面跟 tag 的字节 */
export function jpegTile(tag: number, size = 32): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size).fill(tag);
  bytes.set(JPEG_BYTES.subarray(0, 3));
  return bytes;
}

// 按列存：槽号 = 128 × 列 + 行
function slotOf(column: number, row: number): number {
  return column * PACKET + row;
}

/**
 * 拼一个 bundle：记录按行的顺序首尾相接（同 ArcGIS），空槽的偏移写 60 + 4 × 槽号；
 * emptyOffset 为 'zero' 时空槽写 0（别的工具删除瓦片时的写法）
 */
export function compactBundle(
  records: readonly FixtureRecord[],
  emptyOffset: 'placeholder' | 'zero' = 'placeholder'
): FixtureBundle {
  const ordered = records.toSorted((a, b) => a.row - b.row || a.column - b.column);
  const size = ordered.reduce((sum, record) => sum + 4 + record.data.length, DATA_START);
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  view.setUint32(0, 3, true);
  view.setUint32(4, PACKET * PACKET, true);
  view.setUint32(12, 5, true);
  const offsets = new Map<number, number>();
  let at = DATA_START;
  for (const record of ordered) {
    offsets.set(slotOf(record.column, record.row), at);
    view.setUint32(at, record.length ?? record.data.length, true);
    data.set(record.data, at + 4);
    at += 4 + record.data.length;
  }
  const index = new Uint8Array(16 + PACKET * PACKET * 5 + 16);
  index.set([0x03, 0, 0, 0, 0x10, 0, 0, 0, 0, 0x40, 0, 0, 0x05, 0, 0, 0]);
  for (let slot = 0; slot < PACKET * PACKET; slot++) {
    const offset = offsets.get(slot) ?? (emptyOffset === 'zero' ? 0 : 60 + 4 * slot);
    let rest = offset;
    for (let byte = 0; byte < 5; byte++) {
      index[16 + slot * 5 + byte] = rest % 256;
      rest = Math.floor(rest / 256);
    }
  }
  return {
    index,
    data,
    offsetOf: (column, row) => {
      const offset = offsets.get(slotOf(column, row));
      if (offset === undefined) {
        throw new Error(`没有 ${column},${row} 这块`);
      }
      return offset;
    }
  };
}

/** bundle 放到缓存里：path 是相对缓存根目录、不带扩展名的路径，如 `_alllayers/L10/R0180C0300` */
export function compactFiles(
  root: string,
  bundles: Readonly<Record<string, FixtureBundle>>
): Map<string, Uint8Array<ArrayBuffer>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [path, bundle] of Object.entries(bundles)) {
    files.set(`${root}${path}.bundlx`, bundle.index);
    files.set(`${root}${path}.bundle`, bundle.data);
  }
  return files;
}

const RANGE = /^bytes=(\d+)-(\d*)$/;

/** 像静态文件服务器一样回答：没有的文件 404，带 Range 的 206（终点超出时截到文件末尾，起点超出时 416） */
export function compactResponse(
  files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
  url: string,
  init: RequestInit
): Response {
  const file = files.get(url);
  if (!file) {
    return new Response('Not Found', { status: 404 });
  }
  const range = new Headers(init.headers).get('Range');
  if (range === null) {
    return new Response(file.slice(), { status: 200 });
  }
  const match = RANGE.exec(range);
  if (!match) {
    throw new Error(`测试的服务器只认单段的 Range：${range}`);
  }
  const start = Number(match[1]);
  const end = Math.min(match[2] === '' ? file.length - 1 : Number(match[2]), file.length - 1);
  if (start >= file.length) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.length}` } });
  }
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}` }
  });
}

/** 和 fetch 一样：signal 已经中止时以它的原因结束 */
export function compactFetch(
  files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
): (url: string, init: RequestInit) => Promise<Response> {
  return (url, init) => {
    if (init.signal?.aborted) {
      return Promise.reject(init.signal.reason instanceof Error ? init.signal.reason : new Error('aborted'));
    }
    return Promise.resolve(compactResponse(files, url, init));
  };
}
