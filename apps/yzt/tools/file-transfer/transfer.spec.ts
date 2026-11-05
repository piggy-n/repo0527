import { expect, test } from 'playwright/test';

// 浏览器夹具的边界类型；Node 工具不导入浏览器源码及其环境声明
interface Progress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

interface BrowserFixture {
  upload: (single: boolean) => Promise<{
    result: {
      fields: { key: string; name: string | null; content: string }[];
      token: string;
      contentType: string;
    };
    progress: Progress[];
  }>;
  download: () => Promise<{ progress: Progress[]; type: string; bytes: number[] }>;
  cancelDownload: () => Promise<{ kind: string; progress: Progress[]; errors: string[] }>;
  saveFile: (file: { blob: Blob; fileName: string }) => void;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/transfer-test');
});

test('多文件与 Excel 的 multipart 字段、内容、鉴权和真实发送进度', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const path = '/src/shared/file-transfer/browser-fixture.ts';
    const { upload } = await import(path) as BrowserFixture;
    return [await upload(false), await upload(true)];
  });
  expect(results[0]?.result.fields).toEqual([
    { key: 'files', name: '甲.txt', content: '文档甲' },
    { key: 'files', name: '乙.txt', content: '文档乙' },
    { key: 'categoryId', name: null, content: 'technical-standard-current-survey' },
    { key: 'tag', name: null, content: '综合' },
    { key: 'year', name: null, content: '2026' }
  ]);
  expect(results[1]?.result.fields).toEqual([
    { key: 'file', name: '属性规范.xlsx', content: '文档甲' },
    { key: 'year', name: null, content: '2026' }
  ]);
  for (const { result, progress } of results) {
    expect(result.token).toBe('transfer-test');
    expect(result.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual(expect.objectContaining({ percent: 100 }));
  }
});

test('非文本二进制原样接收并保存，中文文件名、MIME 与进度正确', async ({ page }) => {
  const saved = page.waitForEvent('download');
  const result = await page.evaluate(async () => {
    const path = '/src/shared/file-transfer/browser-fixture.ts';
    const { download } = await import(path) as BrowserFixture;
    return download();
  });
  const download = await saved;
  expect(download.suggestedFilename()).toBe('报告.pdf');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255, 128, 3, 9]));
  expect(result.bytes).toEqual([0, 255, 128, 3, 9]);
  expect(result.type).toBe('application/pdf');
  expect(result.progress.at(-1)).toEqual({ loaded: 5, total: 5, percent: 100 });
});

test('接收过程中取消未知总量的响应，不报告成功或全局错误', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/shared/file-transfer/browser-fixture.ts';
    const { cancelDownload } = await import(path) as BrowserFixture;
    return cancelDownload();
  });
  expect(result.kind).toBe('canceled');
  expect(result.errors).toEqual([]);
  expect(result.progress).toHaveLength(1);
  expect(result.progress[0]).toEqual({ loaded: expect.any(Number), total: null, percent: null });
  expect(result.progress[0]?.loaded).toBeGreaterThan(0);
});

test('保存链接移除后 URL 暂时可读，保留时间结束后释放', async ({ page }) => {
  await page.clock.install();
  const saved = page.waitForEvent('download');
  const url = await page.evaluate(async () => {
    const path = '/src/shared/file-transfer/browser-fixture.ts';
    const { saveFile } = await import(path) as BrowserFixture;
    const create = URL.createObjectURL.bind(URL);
    let created = '';
    URL.createObjectURL = blob => {
      created = create(blob);
      return created;
    };
    try {
      saveFile({ blob: new Blob(['内容']), fileName: '文档.txt' });
    } finally {
      URL.createObjectURL = create;
    }
    return created;
  });
  await saved;
  expect(await page.locator('a[download]').count()).toBe(0);
  expect(await page.evaluate(async value => (await fetch(value)).text(), url)).toBe('内容');
  await page.clock.fastForward(60_000);
  expect(await page.evaluate(value => fetch(value).then(() => true, () => false), url)).toBe(false);
});
