import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.ts';

// 软件渲染时装饰动画让导出排队十几秒（docs/modules/city-dashboard.md），入场由浏览器测试覆盖
test.use({ reducedMotion: 'reduce' });

test('驾驶舱需登录、独立懒加载，缺字体时地图详情及三类图片仍可导出', async ({ page }) => {
  test.setTimeout(90000);
  // 字体不入库，固定复现 Linux CI 及未部署字体的环境
  await page.route('**/fonts/**', route => route.fulfill({ status: 404, body: '' }));
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') { scripts.push(request.url()); } });
  await page.goto('/city-dashboard');
  await expect(page).toHaveURL(/\/login/);
  expect(scripts.some(url => url.includes('CityDashboardPage-'))).toBe(false);
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await expect(page.locator('[data-map-view-state]')).toHaveAttribute('data-map-view-state', 'ready');
  expect(scripts.some(url => url.includes('CityDashboardPage-'))).toBe(false);
  await page.goto('/city-dashboard');
  await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('江苏省城市国土空间监测城市体检驾驶舱');
  await expect(page.getByRole('link', { name: '现状底图', exact: true })).toHaveCount(0);
  expect(scripts.some(url => url.includes('CityDashboardPage-'))).toBe(true);

  // PNG 编码可解码且宽高非零，覆盖空白画布和下载生命周期
  async function download(name: string): Promise<void> {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const result = await waiting;
    expect(await result.failure()).toBeNull();
    const path = await result.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(300);
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(300);
    expect(bytes.byteLength).toBeGreaterThan(10000);
  }
  await download('下载当前地图');
  await download('下载消防救援5分钟可达覆盖率图表');
  await page.getByRole('button', { name: /^南京市，.*查看详情$/ }).click();
  await expect(page.getByText('南京市 · 当前查看城市')).toBeVisible();
  await download('下载详情图表');
  await page.getByRole('button', { name: '关闭此对话框', exact: true }).click();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByText('请选择城市后查看比较数据').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '下载消防救援5分钟可达覆盖率图表', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '南京市', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载消防救援5分钟可达覆盖率图表', exact: true })).toBeEnabled();
});

test('没有 WebGL 时保留二维地图与导出', async ({ page }) => {
  // 只在本例模拟不支持 WebGL，不改生产降级开关
  await page.addInitScript(`(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(name, options) {
        if (name === 'webgl' || name === 'webgl2' || name === 'experimental-webgl') { return null; }
        return Reflect.apply(original, this, [name, options]);
      }
    });
  })();`);
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto('/city-dashboard');
  await expect(page.getByText('地图采用简化显示')).toBeVisible();
  await expect(page.getByRole('img', { name: '消防救援5分钟可达覆盖率二维分布图', exact: true })).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载当前地图', exact: true }).click();
  expect(await (await waiting).failure()).toBeNull();
});

test.describe('驾驶舱触屏与系统减少动画', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });

  test('触摸滚动使用原生吸附，地图拖动不误开详情，窄屏不横向溢出', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByPlaceholder('请输入账号').fill('smoke');
    await page.getByPlaceholder('请输入密码').fill('smoke-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/current-map$/);
    await page.goto('/city-dashboard');
    await expect(page.locator('[data-dashboard-phase]')).toHaveAttribute('data-dashboard-phase', 'ready');
    await expect(page.locator('button[aria-haspopup="dialog"]')).toHaveCount(13);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    const cdp = await context.newCDPSession(page);
    const map = page.getByRole('img', { name: '消防救援5分钟可达覆盖率三维分布图', exact: true });
    const mapBox = (await map.boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mapBox.x + 90, y: mapBox.y + 110 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mapBox.x + 190, y: mapBox.y + 140 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const list = page.locator('[data-card-list]');
    await list.scrollIntoViewIfNeeded();
    const box = (await list.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = Math.min(760, box.y + box.height - 30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      // oxlint-disable-next-line no-await-in-loop -- 手势点必须按顺序发送，浏览器负责滚动和吸附
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 35 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => list.evaluate((element: unknown) => (element as { scrollTop: number }).scrollTop)).toBeGreaterThan(50);
    const positions = () => list.evaluate((element: unknown) => {
      const container = element as { scrollTop: number; scrollHeight: number; clientHeight: number; querySelectorAll(selector: string): ArrayLike<{ offsetTop: number; offsetHeight: number }> };
      return { top: container.scrollTop, maximum: container.scrollHeight - container.clientHeight,
        cards: Array.from(container.querySelectorAll('[data-chart-id]')).map(card => ({ top: card.offsetTop, height: card.offsetHeight })) };
    });
    const distance = async () => {
      const { top, maximum, cards } = await positions();
      return Math.min(...cards.map(card => Math.abs(top - Math.min(card.top, maximum))));
    };
    await expect.poll(distance).toBeLessThan(2);
  });
});
