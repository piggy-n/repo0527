import type { Page } from 'playwright';
import type { BenchCamera } from './bench-api.ts';
import { launchBrowser } from './browser.ts';
import { syncStep } from './look-sync.ts';
import { pageUrl, type RunContext } from './run.ts';
import type { Scene, Variant } from './scenes.ts';

// --look：不测量，每个方案开一个窗口，相机同步，人在窗口里比较（缓存上限的各档、"该清楚却糊"的地方）。
// 页面就是测量页，读数在页面左上角（page/look.ts）

const SYNC_EVERY_MS = 150;
// 封顶 60 帧：几个窗口一起不封顶时互相抢显卡，和用户平时看到的也不一样
const LOOK_FPS = 60;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 浏览器里的代码用字符串调用：这边的 tsconfig 没有 DOM
const readCamera = (page: Page): Promise<BenchCamera | null> =>
  page.isClosed()
    ? Promise.resolve(null)
    : page.evaluate<BenchCamera | null>('window.benchReady === true ? window.bench.camera() : null').catch(() => null);

const setCamera = (page: Page, camera: BenchCamera) =>
  page.isClosed() ? Promise.resolve() : page.evaluate(`window.bench.setCamera(${JSON.stringify(camera)})`).catch(() => undefined);

// 窗口并排：第 index 个放在左数第 index 个位置，屏幕放不下时用户自己挪
async function placeWindow(page: Page, index: number, { width, height }: { width: number; height: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: index * (width + 16), top: 0, width: width + 16, height: height + 120 } });
  } catch {
    // 挪不了窗口不影响看
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export interface LookContext extends Pick<RunContext, 'baseUrl' | 'options' | 'splats'> {
  /** 按了 Ctrl+C */
  readonly stopping: () => boolean;
}

/** 打开窗口，同步相机，直到窗口都关了或者按了 Ctrl+C */
export async function runLook(scene: Scene, list: readonly Variant[], ctx: LookContext): Promise<void> {
  const { options } = ctx;
  const { browser } = await launchBrowser({ ...options, headless: false });
  try {
    const pages: Page[] = [];
    for (const [index, variant] of list.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- 一个窗口一个窗口地开，按顺序排好
      const page = await (await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1 })).newPage();
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await placeWindow(page, index, options.viewport);
      const url = new URL(pageUrl({ scene, variant }, { ...ctx, options: { ...options, fps: options.fps ?? LOOK_FPS } }));
      url.searchParams.set('look', '1');
      url.searchParams.set('label', variant.label);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await page.goto(url.href, { waitUntil: 'commit', timeout: 60000 });
      pages.push(page);
      console.log(`  窗口 ${index + 1}：${variant.label}`);
    }
    console.log('拖动、右键转动、滚轮缩放任意一个窗口，其余的跟着它。关掉所有窗口或按 Ctrl+C 结束。');
    let known: (BenchCamera | null)[] = pages.map(() => null);
    let last: BenchCamera | null = null;
    while (!ctx.stopping() && pages.some(page => !page.isClosed())) {
      // oxlint-disable-next-line no-await-in-loop -- 一轮一轮地同步
      const current = await Promise.all(pages.map(readCamera));
      const { target, followers } = syncStep(current, known, last);
      if (target) {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await Promise.all(
          followers
            .map(index => pages[index])
            .filter(page => page !== undefined)
            .map(page => setCamera(page, target))
        );
        last = target;
      }
      known = current.map((camera, index) => (target && followers.includes(index) ? target : camera));
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await sleep(SYNC_EVERY_MS);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
