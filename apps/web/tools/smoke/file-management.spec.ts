import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';

// oxlint-disable no-await-in-loop -- 同一页面按顺序切换预览和视口，不能并发操作

/** 等待实际过渡结束后再测量和截图，不关闭动画来掩盖布局变化 */
async function settled(page: Page) {
  await page.evaluate('document.fonts.ready');
  await page.evaluate('Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getTiming().iterations)).map(a => a.finished.catch(() => {})))');
}

// 只使用随仓库保存的自建文档，不上传或下载真实业务文件
const samples = ['txt', 'docx', 'png', 'pdf', 'zip'];
const textContent = '调查成果说明\n<script>仅作为文本显示</script>';
const categoryId = 'technical-standard-current-survey';
const records = samples.map(type => ({
  id: type, name: `验收资料.${type}`, type, objectKey: type, categoryId,
  size: 4096, year: '2026', tag: '综合', remark: '固定接口验收',
  createdName: '测试用户', createdTime: '2026-10-21 12:00:00'
}));

/** 登录、列表与文件内容均经过正式页面和公共请求层 */
async function openFiles(page: Page) {
  await page.route('**/backend/file/page?*', route => route.fulfill({
    json: { code: 200, data: {
      content: records, pageNo: 1, pageSize: 10, totalElements: records.length, totalPages: 1
    } }
  }));
  await page.route('**/backend/file/download?*', async route => {
    const type = new URL(route.request().url()).searchParams.get('objectKey');
    expect(samples).toContain(type);
    const body = type === 'txt' ? Buffer.from(textContent, 'utf8') : type === 'zip' ? Buffer.from('fixture')
      : await readFile(new URL(`../../src/features/file-management/fixtures/sample.${type}`, import.meta.url));
    await route.fulfill({
      body,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`验收资料.${type}`)}`
      }
    });
  });
  await page.goto('/file-management');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('link', { name: '文件管理', exact: true }).click();
  await expect(page).toHaveURL(/\/file-management$/);
  await expect(page.locator('.el-table__body tr')).toHaveCount(samples.length);
}

test('文件预览使用实际阅读器，下载保留中文文件名和原始内容', async ({ page }) => {
  await openFiles(page);
  const row = (type: string) => page.locator('.el-table__body tr').filter({ hasText: `验收资料.${type}` });
  await expect(row('zip').getByText('仅下载', { exact: true })).toBeVisible();
  await expect(row('zip').getByRole('button', { name: '预览' })).toHaveCount(0);
  await expect(row('png').getByText('仅下载', { exact: true })).toBeVisible();
  await expect(row('png').getByRole('button', { name: '预览' })).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: '文件预览', exact: true });
  // CI 的 headless shell 不带 PDF 阅读器；指定完整浏览器 channel 时一并实测 PDF
  const previewTypes = test.info().project.use.channel ? ['txt', 'docx', 'pdf'] : ['txt', 'docx'];
  for (const type of previewTypes) {
    await row(type).getByRole('button', { name: '预览', exact: true }).click();
    await expect(dialog).toBeVisible();
    await settled(page);
    await expect(dialog.getByLabel('文件阅读区')).toHaveAttribute('aria-busy', 'false');
    if (type === 'txt') {
      await expect(dialog.locator('pre')).toHaveText(textContent);
    } else if (type === 'docx') {
      await expect(dialog.locator('iframe').contentFrame().locator('section.file-docx').first()).toBeVisible();
      await expect(dialog.getByText('100%', { exact: true })).toBeVisible();
      for (const [width, height] of [[1440, 900], [1200, 800], [1199, 800], [760, 640], [390, 844], [1440, 600]]) {
        await page.setViewportSize({ width, height });
        await settled(page);
        const name = await dialog.getByText('验收资料.docx', { exact: true }).boundingBox();
        const zoom = await dialog.getByRole('button', { name: '缩小', exact: true }).boundingBox();
        const reader = await dialog.getByLabel('文件阅读区').boundingBox();
        expect(Math.abs(name!.y + name!.height / 2 - zoom!.y - zoom!.height / 2)).toBeLessThanOrEqual(2);
        expect(reader!.y - zoom!.y - zoom!.height).toBe(8);
        await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
        await expect(dialog.getByRole('button', { name: '下载文件', exact: true })).toBeInViewport();
        expect(await page.locator('html').evaluate((element: { scrollWidth: number }) => element.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: test.info().outputPath(`docx-compact-${width}x${height}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    } else {
      await expect(dialog.getByTitle('PDF 阅读区')).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`preview-${type}.png`) });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await settled(page);
  }
  const finished = page.waitForEvent('download');
  await row('txt').getByRole('button', { name: '下载', exact: true }).click();
  const download = await finished;
  expect(download.suggestedFilename()).toBe('验收资料.txt');
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path, 'utf8')).toBe(textContent);
  await expect(row('txt').getByRole('button', { name: '下载', exact: true })).toBeEnabled();
  const imageFinished = page.waitForEvent('download');
  await row('png').getByRole('button', { name: '下载', exact: true }).click();
  const imageDownload = await imageFinished;
  expect(imageDownload.suggestedFilename()).toBe('验收资料.png');
  const imagePath = await imageDownload.path();
  expect(imagePath).not.toBeNull();
  expect(await readFile(imagePath)).toEqual(await readFile(new URL('../../src/features/file-management/fixtures/sample.png', import.meta.url)));
});

test('文件列表和上传窗口在断点两侧及低高度下保留完整操作入口', async ({ page }) => {
  await openFiles(page);
  const dialog = page.getByRole('dialog', { name: '上传文件', exact: true });
  for (const [width, height] of [[1440, 900], [1200, 800], [1199, 800], [760, 640], [390, 844], [1440, 600]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeInViewport();
    await settled(page);
    await page.screenshot({ path: test.info().outputPath(`list-${width}x${height}.png`) });
    await page.getByRole('button', { name: '上传文件', exact: true }).click();
    await expect(dialog).toBeVisible();
    await settled(page);
    await expect(dialog.getByRole('button', { name: '开始上传', exact: true })).toBeInViewport();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    expect(await page.locator('html').evaluate((element: { scrollWidth: number }) => element.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`upload-${width}x${height}.png`) });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await settled(page);
  }
  await page.getByRole('button', { name: '上传文件', exact: true }).click();
  await dialog.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(dialog.getByText('请至少选择一个文件', { exact: true })).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles({
    name: '待选文件.txt', mimeType: 'text/plain', buffer: Buffer.from('本地验收')
  });
  await expect(dialog.getByRole('list', { name: '待上传文件列表' })).toContainText('待选文件.txt');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '上传文件', exact: true }).click();
  await expect(dialog.getByRole('list', { name: '待上传文件列表' }).locator('li')).toHaveCount(0);
});
