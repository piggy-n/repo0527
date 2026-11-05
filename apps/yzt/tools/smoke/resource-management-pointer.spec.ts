import { expect, sessionToken, test } from './fixtures.ts';

// 主要用鼠标、同时接着触屏或虚拟触控设备的环境。blink-settings 的取值是位掩码：粗指针 2、细指针 4；不能悬浮 1、能悬浮 2。
// launchOptions 是浏览器进程的选项，只能写在文件顶层，所以单独一个文件；覆盖配置里的 args，要带上软件渲染
test.use({
  launchOptions: {
    args: [
      '--use-angle=swiftshader',
      '--blink-settings=availablePointerTypes=6,primaryPointerType=4,availableHoverTypes=3,primaryHoverType=2'
    ]
  }
});

test('鼠标和粗指针设备并存时，目录操作仍跟随整行悬浮，不会全部显示', async ({ context, page }, testInfo) => {
  await context.route('**/backend/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.slice('/backend'.length);
    const responses: Record<string, unknown> = {
      '/user/login': { token: sessionToken(), loginName: 'smoke', realName: '冒烟测试', roleCode: 'admin' },
      '/resource-center/tree': [
        { id: 'base', name: '基础库', children: [{ id: 'land', name: '土地资源' }, { id: 'water', name: '水资源' }] }
      ],
      '/resource-center/year/list': [],
      '/resource-management/layer/page': { list: [], total: 0, pages: 0, pageNum: 1, pageSize: 20 }
    };
    if (endpoint in responses) {
      await route.fulfill({ json: { code: 200, data: responses[endpoint] } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto('/resource-management');

  const rowOf = (name: string) =>
    page
      .getByRole('button', { name: `重命名${name}`, exact: true })
      .locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]');
  const landActions = rowOf('土地资源').locator('[class*="_treeActions_"]');
  const waterActions = rowOf('水资源').locator('[class*="_treeActions_"]');
  await expect(landActions).toBeAttached();
  // tools 没有 DOM 类型，表达式写成字符串
  const pointers = await page.evaluate("[matchMedia('(any-pointer: coarse)').matches, matchMedia('(hover: none)').matches]");
  expect(pointers, '环境要是存在粗指针、主指针能悬浮').toEqual([true, false]);

  await page.mouse.move(700, 130);
  await page.screenshot({ path: testInfo.outputPath('directory-idle.png') });
  await expect(landActions).toHaveCSS('opacity', '0');
  await expect(waterActions).toHaveCSS('opacity', '0');

  await rowOf('土地资源').hover();
  await page.screenshot({ path: testInfo.outputPath('directory-hover.png') });
  await expect(landActions).toHaveCSS('opacity', '1');
  await expect(waterActions).toHaveCSS('opacity', '0');
});
