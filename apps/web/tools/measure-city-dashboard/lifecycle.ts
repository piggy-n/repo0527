import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// 仅操作 D3 真实组件预览的进入/退出按钮，测同一文档中的释放趋势；不用于生产业务入口
const url = process.argv[2] ?? 'http://127.0.0.1:5188/design.local/city-dashboard/index.html';
const cycles = Number(process.argv[3] ?? 30);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`(() => {
    const data = globalThis.dashboardResources = { live: {}, created: {}, released: {}, clears:0 };
    const states = new WeakMap();
    const prototype = WebGL2RenderingContext.prototype;
    for (const name of ['Buffer','Texture','Framebuffer','Renderbuffer','Program','Shader','VertexArray']) {
      data.live[name] = 0; data.created[name] = 0; data.released[name] = 0;
      const create = prototype['create'+name], remove = prototype['delete'+name];
      prototype['create'+name] = function(...args) {
        let state = states.get(this);
        if (!state) {
          state = { counts:{}, lost:false }; states.set(this,state);
          this.canvas.addEventListener('webglcontextlost', () => {
            state.lost = true;
            for (const [key,count] of Object.entries(state.counts)) { data.live[key] -= count; data.released[key] += count; }
            state.counts = {};
          }, { once:true });
        }
        const result = Reflect.apply(create,this,args);
        if (result && !state.lost) { data.live[name]++; data.created[name]++; state.counts[name] = (state.counts[name]||0)+1; }
        return result;
      };
      prototype['delete'+name] = function(object) {
        const state = states.get(this);
        if (object && state && !state.lost && state.counts[name] > 0) { data.live[name]--; data.released[name]++; state.counts[name]--; }
        return Reflect.apply(remove,this,[object]);
      };
    }
    const clear = prototype.clear;
    prototype.clear = function(...args) { data.clears++; return Reflect.apply(clear,this,args); };
  })();`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(url);
  const samples: unknown[] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    // oxlint-disable-next-line no-await-in-loop -- 每轮就绪后再采样，必须验证上一轮已释放
    await page.locator('[data-dashboard-phase="ready"]').waitFor();
    // oxlint-disable-next-line no-await-in-loop -- 所有轮次都切换到长分类，覆盖 ECharts 的创建/释放
    await page.getByRole('button', { name: '共享幸福', exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- 等待真实图表绘制完成的短采样间隔
    await page.waitForTimeout(300);
    // oxlint-disable-next-line no-await-in-loop -- 活跃画布上限
    const activeCanvases = await page.locator('canvas').count();
    // oxlint-disable-next-line no-await-in-loop -- 使用预览真实卸载入口
    await page.getByRole('button', { name: 'D3 预览工具', exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- 本轮退出
    await page.getByRole('button', { name: '退出驾驶舱', exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- 等待 WebGL 上下文丢失事件和延迟清理到达
    await page.waitForTimeout(150);
    // oxlint-disable-next-line no-await-in-loop -- 手动 GC 只作同条件趋势比较
    await cdp.send('HeapProfiler.collectGarbage');
    // oxlint-disable-next-line no-await-in-loop -- 堆量
    const heap = await cdp.send('Runtime.getHeapUsage');
    // oxlint-disable-next-line no-await-in-loop -- DOM/监听数
    const dom = await cdp.send('Memory.getDOMCounters');
    // oxlint-disable-next-line no-await-in-loop -- 只读取测试注入的计数
    const resources = await page.evaluate('globalThis.dashboardResources') as { live: Record<string, number> };
    // oxlint-disable-next-line no-await-in-loop -- 卸载画布计数
    const remaining = await page.locator('canvas').count();
    samples.push({ cycle: cycle + 1, heap: heap.usedSize, dom, activeCanvases, remaining, resources });
    if (remaining || Object.values(resources.live).some(count => count !== 0)) { throw new Error('卸载后仍有画布或 WebGL 对象'); }
    console.log(`cycle ${cycle + 1}: heap ${heap.usedSize}, nodes ${dom.nodes}, listeners ${dom.jsEventListeners}, canvases ${remaining}`);
    if (cycle < cycles - 1) {
      // oxlint-disable-next-line no-await-in-loop -- 重新进入同一个文档
      await page.getByRole('button', { name: 'D3 预览工具', exact: true }).click();
      // oxlint-disable-next-line no-await-in-loop -- 本轮进入
      await page.getByRole('button', { name: '重新进入', exact: true }).click();
    }
  }
  if (errors.length) { throw new Error(errors.join('\n')); }
  const output = resolve(import.meta.dirname, 'results.local');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'd3-lifecycle.json'), JSON.stringify({ url, renderer: 'Chromium SwiftShader', samples, errors }, null, 2), 'utf8');
} finally { await browser.close(); }
