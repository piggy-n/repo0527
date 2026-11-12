import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdbStore, PREFERENCE_DATABASE, PREFERENCE_OBJECT_STORE } from '@/shared/storage/idb-store';
import { required } from '@/shared/testing/required';
import { RESOURCE_SYMBOLS_PREFERENCE } from '../resource-symbols';
import snippet from './export-snippet.js?raw';

// 真实的 IndexedDB：片段里的数据库名换成每个用例自己的，其余和用户粘贴到控制台的原文相同
const DATABASE_LINE = `const DATABASE = '${PREFERENCE_DATABASE}';`;
const NOTHING = '这个浏览器上没有保存过资源图层的符号';

const keyOf = (login: string) => `${encodeURIComponent(login)}/${RESOURCE_SYMBOLS_PREFERENCE}`;
const databaseName = () => `yzt-test-${crypto.randomUUID()}`;

async function run(database: string): Promise<unknown> {
  // oxlint-disable-next-line no-eval -- 和粘贴到控制台一样，按脚本执行片段的原文
  const result: unknown = (0, eval)(snippet.replace(DATABASE_LINE, `const DATABASE = '${database}';`));
  if (!(result instanceof Promise)) {
    throw new TypeError('片段应当返回 Promise');
  }
  return result;
}

// 接住下载：记下文件名和内容，不真的下载
function captureDownloads() {
  const files: { name: string; blob: Blob }[] = [];
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(object => {
    blob = object instanceof Blob ? object : null;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    files.push({ name: this.download, blob: required(blob, '下载的内容') });
  });
  return files;
}

async function databaseNames(): Promise<(string | undefined)[]> {
  return (await indexedDB.databases()).map(info => info.name);
}

describe('导出符号的控制台片段（真实的 IndexedDB）', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('读的就是应用存偏好的数据库、仓库和键', () => {
    expect(snippet).toContain(DATABASE_LINE);
    expect(snippet).toContain(`const STORE = '${PREFERENCE_OBJECT_STORE}';`);
    expect(snippet).toContain(`const SUFFIX = '/${RESOURCE_SYMBOLS_PREFERENCE}';`);
  });

  it('读出这个浏览器上所有账号的符号，下载成一个文件；别的偏好不带上', async () => {
    const database = databaseName();
    const store = createIdbStore(database, PREFERENCE_OBJECT_STORE);
    const record = { version: 1, value: { szy_kt: { uniform: { fillColor: 'rgba(0, 0, 0, 1)' } } } };
    await store.set(keyOf('zhangsan'), record);
    await store.set(keyOf('张三'), { version: 1, value: {} });
    await store.set('zhangsan/resource-layers', { version: 1, value: { order: [] } });
    const files = captureDownloads();
    // 只固定日期，IndexedDB 的回调照常
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T08:00:00.000Z'));

    // 键按 IndexedDB 的顺序：编码后的中文登录名以 % 开头，排在前面
    expect(await run(database)).toBe('已导出 2 个账号的图例样式：张三、zhangsan');
    expect(files.map(file => file.name)).toStrictEqual(['resource-symbols-2026-11-11.json']);
    const file: unknown = JSON.parse(await required(files[0], '下载的文件').blob.text());
    expect(file).toStrictEqual({
      kind: 'yzt-resource-symbols',
      exportedAt: '2026-11-11T08:00:00.000Z',
      entries: [
        { key: keyOf('张三'), record: { version: 1, value: {} } },
        { key: keyOf('zhangsan'), record }
      ]
    });
  });

  it('只开只读事务，存下的数据不变', async () => {
    const database = databaseName();
    const store = createIdbStore(database, PREFERENCE_OBJECT_STORE);
    const record = { version: 1, value: { szy_kt: { uniform: { fillColor: 'rgba(0, 0, 0, 1)' } } } };
    await store.set(keyOf('zhangsan'), record);
    captureDownloads();
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');

    await run(database);

    expect(transaction.mock.calls.map(([, mode]) => mode)).toStrictEqual(['readonly']);
    transaction.mockRestore();
    expect(await store.get(keyOf('zhangsan'))).toStrictEqual(record);
  });

  it('数据库不存在时报错，不打开、不新建数据库', async () => {
    const database = databaseName();
    const files = captureDownloads();
    const open = vi.spyOn(indexedDB, 'open');

    await expect(run(database)).rejects.toThrow(NOTHING);

    expect(open).not.toHaveBeenCalled();
    expect(await databaseNames()).not.toContain(database);
    expect(files).toStrictEqual([]);
  });

  it('列不出数据库或列出的不准时，打开时中止建库，不留下空库', async () => {
    const database = databaseName();
    captureDownloads();
    const databases = vi.spyOn(indexedDB, 'databases').mockResolvedValue([{ name: database, version: 1 }]);

    await expect(run(database)).rejects.toThrow(NOTHING);

    databases.mockRestore();
    expect(await databaseNames()).not.toContain(database);
  });

  it('数据库里没有符号时报错，不下载', async () => {
    const database = databaseName();
    await createIdbStore(database, PREFERENCE_OBJECT_STORE).set('zhangsan/resource-layers', { version: 1, value: {} });
    const files = captureDownloads();

    await expect(run(database)).rejects.toThrow(NOTHING);

    expect(files).toStrictEqual([]);
  });
});
