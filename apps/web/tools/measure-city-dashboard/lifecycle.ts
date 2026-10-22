import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type CDPSession, chromium, type Page } from 'playwright';

// 驾驶舱的释放实测（docs/modules/city-dashboard.md）：node tools/measure-city-dashboard/lifecycle.ts [预览地址] [次数]
// 只操作 D3 真实组件预览里的进入、退出按钮，在同一个文档里看释放的趋势；不用于生产业务入口
const url = process.argv[2] ?? 'http://127.0.0.1:5188/design.local/city-dashboard/index.html';
const cycles = Number(process.argv[3] ?? 30);

// 浏览器里的计数：按 WebGL 上下文记录各类对象的创建和删除，上下文丢失时它的对象全部算作释放
const PROBE = `(() => {
  const data = globalThis.dashboardResources = { live: {}, created: {}, released: {}, clears: 0 };
  const states = new WeakMap();
  const prototype = WebGL2RenderingContext.prototype;
  const stateOf = context => {
    let state = states.get(context);
    if (!state) {
      state = { counts: {}, lost: false };
      states.set(context, state);
      context.canvas.addEventListener('webglcontextlost', () => {
        state.lost = true;
        for (const [key, count] of Object.entries(state.counts)) {
          data.live[key] -= count;
          data.released[key] += count;
        }
        state.counts = {};
      }, { once: true });
    }
    return state;
  };
  for (const name of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray']) {
    data.live[name] = 0;
    data.created[name] = 0;
    data.released[name] = 0;
    const create = prototype['create' + name];
    const remove = prototype['delete' + name];
    prototype['create' + name] = function (...args) {
      const state = stateOf(this);
      const result = Reflect.apply(create, this, args);
      if (result && !state.lost) {
        data.live[name]++;
        data.created[name]++;
        state.counts[name] = (state.counts[name] || 0) + 1;
      }
      return result;
    };
    prototype['delete' + name] = function (object) {
      const state = states.get(this);
      if (object && state && !state.lost && state.counts[name] > 0) {
        data.live[name]--;
        data.released[name]++;
        state.counts[name]--;
      }
      return Reflect.apply(remove, this, [object]);
    };
  }
  const clear = prototype.clear;
  prototype.clear = function (...args) {
    data.clears++;
    return Reflect.apply(clear, this, args);
  };
})();`;

const clickButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

/** 一轮：就绪后切到最长的分类（覆盖图表的创建和释放），退出驾驶舱，回收后取样；有残留时失败 */
async function measureCycle(page: Page, cdp: CDPSession, cycle: number) {
  await page.locator('[data-dashboard-phase="ready"]').waitFor();
  await clickButton(page, '共享幸福');
  // 给图表画完的时间
  await page.waitForTimeout(300);
  const activeCanvases = await page.locator('canvas').count();
  await clickButton(page, 'D3 预览工具');
  await clickButton(page, '退出驾驶舱');
  // 等 WebGL 上下文丢失的事件和延迟的清理
  await page.waitForTimeout(150);
  // 强制回收后的堆量只用来看同条件下的趋势
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const resources = (await page.evaluate('globalThis.dashboardResources')) as { live: Record<string, number> };
  const remaining = await page.locator('canvas').count();
  if (remaining > 0 || Object.values(resources.live).some(count => count !== 0)) {
    throw new Error('卸载后仍有画布或 WebGL 对象');
  }
  console.log(`cycle ${cycle}: heap ${heap.usedSize}, nodes ${dom.nodes}, listeners ${dom.jsEventListeners}, canvases ${remaining}`);
  return { cycle, heap: heap.usedSize, dom, activeCanvases, remaining, resources };
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(PROBE);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(url);
  const samples = [];
  for (let cycle = 1; cycle <= cycles; cycle++) {
    // 每一轮都要确认上一轮已经释放干净，只能依次进行
    // oxlint-disable-next-line no-await-in-loop -- 同上
    samples.push(await measureCycle(page, cdp, cycle));
    if (cycle < cycles) {
      // oxlint-disable-next-line no-await-in-loop -- 在同一个文档里重新进入
      await clickButton(page, 'D3 预览工具');
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await clickButton(page, '重新进入');
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  const output = resolve(import.meta.dirname, 'results.local');
  await mkdir(output, { recursive: true });
  const report = { url, renderer: 'Chromium SwiftShader', samples, errors };
  await writeFile(resolve(output, 'd3-lifecycle.json'), JSON.stringify(report, null, 2), 'utf8');
} finally {
  await browser.close();
}
