import { crc32, deflateSync } from 'node:zlib';
import type { Locator, Page } from 'playwright/test';
import { CURRENT_MAP_URL, expect, test } from './fixtures.ts';

// 服务器底图（ADR 0165）：真实瓦片是数据方的，不入库，冒烟自己生成第一代紧凑缓存（ADR 0165 第 6 节）。
// 每套一种纯色，每个 bundle 的每个槽都指向同一块瓦片；冒烟不导入应用源码，格式按 map-core 的读取器另写一遍

type Rgb = readonly [number, number, number];

// 两套的颜色：页面上别处没有，和静态底图的陆地、背景、省界都差得远
const STANDARD_COLOR: Rgb = [0xc0, 0x40, 0x80];
const IMAGERY_COLOR: Rgb = [0x30, 0x70, 0x50];
// 纯色瓦片放大、三维里贴到地球上都还是这个颜色，留一点余量
const TOLERANCE = 3;
// 默认视角下底图的范围占画面的比例远大于它
const MIN_SHARE = 0.05;

// 一个 bundle 是 128 × 128 块；.bundle 的头 60 字节和 16384 × 4 字节的占位区之后才是瓦片的记录
const SLOTS = 128 * 128;
const DATA_START = 60 + SLOTS * 4;
const INDEX_MAGIC = [0x03, 0, 0, 0, 0x10, 0, 0, 0, 0, 0x40, 0, 0, 0x05, 0, 0, 0];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TILE_SIZE = 256;

// 读取器请求的文件：<前缀>/_alllayers/L<两位级别>/R<行>C<列>.bundlx 或 .bundle
const CACHE_FILE = /^\/basemap\/([a-z-]+)\/_alllayers\/L\d{2}\/R[\da-f]{4,}C[\da-f]{4,}\.(bundlx|bundle)$/;
// 探测读的南京那块 z10 瓦片所在的 bundle
const PROBE_BUNDLE = '_alllayers/L10/R0180C0300';

/** 通过真实登录表单提交，只替换接口响应 */
async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

/** 等一轮加载标记的某个步骤（docs/modules/perf.md）；等不到时以断言失败，说明是哪一步 */
async function measured(page: Page, name: string, timeout: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(entry => performance.getEntriesByName(entry, 'measure').length > 0, name), {
      message: `等到 ${name}`,
      timeout
    })
    .toBe(true);
}

/** 当前缩略图角上的入口平时隐藏、不接收点击，悬停在缩略图上才出现（ADR 0146） */
async function openAdjustments(page: Page): Promise<void> {
  const adjust = page.getByRole('button', { name: '调整标注和透明度' });
  await adjust.locator('..').hover();
  await adjust.click();
}

// PNG 的一块：长度、类型、数据，CRC 按类型加数据算
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** 一块 256 像素的纯色 PNG（8 位 RGB，不隔行） */
function solidPng([red, green, blue]: Rgb): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(TILE_SIZE, 0);
  header.writeUInt32BE(TILE_SIZE, 4);
  // 位深 8、颜色类型 2（RGB），压缩、过滤、隔行都是 0
  header[8] = 8;
  header[9] = 2;
  // 每行开头一个字节的过滤方式 0
  const row = Buffer.alloc(1 + TILE_SIZE * 3);
  for (let x = 0; x < TILE_SIZE; x++) {
    row[1 + x * 3] = red;
    row[2 + x * 3] = green;
    row[3 + x * 3] = blue;
  }
  const pixels = Buffer.concat(Array.from({ length: TILE_SIZE }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

interface CompactBundle {
  readonly index: Buffer;
  readonly data: Buffer;
}

/** 一对 .bundlx 和 .bundle：16 字节头加每槽 5 字节的小端偏移加 16 字节尾，每个槽都指向占位区后面那一条记录 */
function compactBundle(tile: Buffer): CompactBundle {
  const index = Buffer.alloc(16 + SLOTS * 5 + 16);
  index.set(INDEX_MAGIC, 0);
  for (let slot = 0; slot < SLOTS; slot++) {
    index.writeUIntLE(DATA_START, 16 + slot * 5, 5);
  }
  // 记录是 4 字节小端的长度加图片
  const data = Buffer.alloc(DATA_START + 4 + tile.length);
  data.writeUInt32LE(tile.length, DATA_START);
  tile.copy(data, DATA_START + 4);
  return { index, data };
}

/**
 * 像 nginx 的 alias 那样提供几套缓存：.bundlx 整份 200，.bundle 按 Range 回 206 和 Content-Range；
 * 没提供的前缀和别的地址回 404。返回没带 Range 的 .bundle 请求，读取器不应该发
 */
async function serveBasemaps(page: Page, served: Readonly<Record<string, Rgb>>): Promise<string[]> {
  const caches = new Map(Object.entries(served).map(([prefix, color]) => [prefix, compactBundle(solidPng(color))]));
  const withoutRange: string[] = [];
  await page.route('**/basemap/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const file = CACHE_FILE.exec(pathname);
    const cache = file ? caches.get(file[1]) : undefined;
    if (!file || !cache) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    if (file[2] === 'bundlx') {
      await route.fulfill({ body: cache.index, contentType: 'application/octet-stream' });
      return;
    }
    const size = cache.data.length;
    const range = /^bytes=(\d+)-(\d+)$/.exec((await request.headerValue('range')) ?? '');
    if (!range) {
      withoutRange.push(pathname);
      await route.fulfill({ body: cache.data, contentType: 'application/octet-stream' });
      return;
    }
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), size - 1);
    if (start > end) {
      await route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${size}` }, body: '' });
      return;
    }
    await route.fulfill({
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${size}` },
      contentType: 'application/octet-stream',
      body: cache.data.subarray(start, end + 1)
    });
  });
  return withoutRange;
}

// 在页面里解码截图并统计像素：工具的类型环境没有 DOM，这段写成字符串交给浏览器执行
const SHARE_OF_COLOR = `async ({ png, color, tolerance }) => {
  const image = new Image();
  image.src = 'data:image/png;base64,' + png;
  await image.decode();
  const buffer = document.createElement('canvas');
  buffer.width = image.width;
  buffer.height = image.height;
  const context = buffer.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, buffer.width, buffer.height);
  let matched = 0;
  for (let i = 0; i < data.length; i += 4) {
    const near =
      Math.abs(data[i] - color[0]) <= tolerance &&
      Math.abs(data[i + 1] - color[1]) <= tolerance &&
      Math.abs(data[i + 2] - color[2]) <= tolerance;
    matched += near ? 1 : 0;
  }
  return matched / (data.length / 4);
}`;

/** 画布的截图里某一套底图颜色的像素占比：真实引擎经自定义协议拿到瓦片、实际画出来的结果 */
async function colorShare(page: Page, canvas: Locator, color: Rgb): Promise<number> {
  const png = (await canvas.screenshot()).toString('base64');
  const input = JSON.stringify({ png, color, tolerance: TOLERANCE });
  return page.evaluate<number>(`(${SHARE_OF_COLOR})(${input})`);
}

/** 底图面板里的缩略图按钮，按显示的顺序；无障碍名称是全称（不含当前缩略图角上的入口） */
function optionButtons(page: Page): Locator {
  return page.getByRole('group', { name: '底图', exact: true }).locator('button[aria-label$="底图"]');
}

// 这台服务器配了标准和影像、没配黑色和极夜蓝（ADR 0165 第 1 节）：探测以后面板是标准、影像、静态 / 无底图，
// 二维默认标准，三维选影像、切回二维回到标准；瓦片经 arcgis-compact:// 协议按 Range 读出来、画在画布上
test('服务器底图：探测到的按顺序出现，二维默认标准，三维换影像、切回标准，瓦片按 Range 读出来画上', async ({
  page
}) => {
  // 软件渲染下三维的瓦片慢
  test.setTimeout(180_000);
  const withoutRange = await serveBasemaps(page, { standard: STANDARD_COLOR, imagery: IMAGERY_COLOR });
  const requested: string[] = [];
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/basemap/')) {
      requested.push(pathname);
    }
  });
  // 探测把网络错误、超时、5xx 记成一条 [basemap] 警告；404 不记。"Failed to load resource" 是浏览器自己报的 404
  const consoleProblems: string[] = [];
  page.on('console', message => {
    const text = message.text();
    const problem =
      (message.type() === 'error' && !text.startsWith('Failed to load resource')) || text.includes('[basemap]');
    if (problem) {
      consoleProblems.push(`${message.type()}: ${text}`);
    }
  });

  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(CURRENT_MAP_URL);
  await measured(page, 'login-to-map:settled', 45_000);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);

  const flat = page.locator('.maplibregl-canvas');
  const card = page.locator('button[aria-label^="底图："]');
  await expect(card, '有标准时二维默认标准').toHaveAttribute('aria-label', '底图：标准底图');
  await expect
    .poll(() => colorShare(page, flat, STANDARD_COLOR), { message: '二维画出标准底图的瓦片' })
    .toBeGreaterThan(MIN_SHARE);

  await card.click();
  const options = optionButtons(page);
  await expect(options).toHaveCount(4);
  const names = await Promise.all((await options.all()).map(option => option.getAttribute('aria-label')));
  expect(names, '没配的黑色、极夜蓝不占位').toEqual(['标准底图', '影像底图', '静态底图', '无底图']);
  await expect(options.first()).toHaveAttribute('aria-pressed', 'true');
  // 三列：前三张一行，无底图在第二行
  const boxes = await Promise.all((await options.all()).map(option => option.boundingBox()));
  const tops = boxes.map((box, index) => {
    if (!box) {
      throw new Error(`量不到第 ${index + 1} 张缩略图`);
    }
    return box.y;
  });
  expect(tops[1]).toBe(tops[0]);
  expect(tops[2]).toBe(tops[0]);
  expect(tops[3]).toBeGreaterThan(tops[0]);
  // 标准的地名印在图上：标注开关显示为开、置灰（ADR 0165 第 7 节；旁边说明的叫法暂定，这里不比文字）
  await openAdjustments(page);
  const labels = page.getByRole('switch', { name: '底图标注' });
  await expect(labels).toBeDisabled();
  await expect(labels).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(labels).toHaveCount(0);

  // 只选过标准：影像的数据源不在样式里，只有探测读过它那块瓦片
  expect(requested.filter(path => path.startsWith('/basemap/imagery/')), '二维时影像只有探测的两个请求').toEqual([
    `/basemap/imagery/${PROBE_BUNDLE}.bundlx`,
    `/basemap/imagery/${PROBE_BUNDLE}.bundle`
  ]);

  await page.getByRole('button', { name: '三维', exact: true }).click();
  await measured(page, 'switch-to-3d:settled', 60_000);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);
  await expect(card, '三维有影像时选影像').toHaveAttribute('aria-label', '底图：影像底图');
  // 二三维共用一块画布（ADR 0147 第 2 节）
  await expect
    .poll(() => colorShare(page, flat, IMAGERY_COLOR), { message: '三维画出影像的瓦片', timeout: 60_000 })
    .toBeGreaterThan(MIN_SHARE);

  await page.getByRole('button', { name: '二维', exact: true }).click();
  await expect(card, '切回二维选二维的默认').toHaveAttribute('aria-label', '底图：标准底图');
  await expect
    .poll(() => colorShare(page, flat, STANDARD_COLOR), { message: '切回二维又画出标准底图', timeout: 60_000 })
    .toBeGreaterThan(MIN_SHARE);

  expect(
    requested.filter(path => !CACHE_FILE.test(path)),
    '只请求紧凑缓存的 .bundlx、.bundle'
  ).toEqual([]);
  for (const prefix of ['black', 'night-blue']) {
    expect(
      requested.filter(path => path.startsWith(`/basemap/${prefix}/`)),
      `没配的 ${prefix} 只有探测读的那个索引，404 以后不再读`
    ).toEqual([`/basemap/${prefix}/${PROBE_BUNDLE}.bundlx`]);
  }
  const tilesOf = (prefix: string) =>
    requested.filter(path => path.startsWith(`/basemap/${prefix}/`) && path.endsWith('.bundle')).length;
  expect(tilesOf('standard'), '标准底图读了多块瓦片').toBeGreaterThan(1);
  expect(tilesOf('imagery'), '影像在三维里读了瓦片').toBeGreaterThan(1);
  expect(withoutRange, '.bundle 都按 Range 读').toEqual([]);
  expect(consoleProblems, '没有警告和报错').toEqual([]);
});
