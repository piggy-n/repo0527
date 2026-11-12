import type { Page } from 'playwright';
import type { BenchCamera } from './bench-api.ts';
import { launchBrowser } from './browser.ts';
import { ignoreBusy, segmentMs, syncStep } from './look-sync.ts';
import { pageUrl, type RunContext } from './run.ts';
import type { Scene, Variant } from './scenes.ts';

// --look：不测量，每个方案开一个窗口，相机同步，人在窗口里找视角、肉眼看（缓存上限的各档、"该清楚却糊"的地方）。
// 页面就是测量页，跟随、用户操作、按 R 重新稳定和左上角的读数在 page/look.ts。档位之间的比较以 --at 的测量为准

const SYNC_EVERY_MS = 150;
// 封顶 60 帧：几个窗口一起不封顶时互相抢显卡，和用户平时看到的也不一样
const LOOK_FPS = 60;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 页面报告的这一轮的状态（page/look.ts 的 LookState，这边的 tsconfig 没有 DOM，类型照写一份） */
interface PageState {
  readonly camera: BenchCamera;
  readonly following: boolean;
  readonly driving: boolean;
  readonly resettle: boolean;
}

// 浏览器里的代码用字符串调用。相机还没到场景的位置时（等模型就绪后那一跳）当作没就绪
const readState = (page: Page): Promise<PageState | null> =>
  page.isClosed()
    ? Promise.resolve(null)
    : page
        .evaluate<PageState | null>('window.benchReady === true && window.bench.placed() ? window.bench.look.state() : null')
        .catch(() => null);

// 跟随的窗口一帧一帧地走过去，不瞬移；等到页面开始走了才返回，下一轮读到的 following 才算数
const follow = (page: Page, camera: BenchCamera, ms: number) =>
  page.isClosed()
    ? Promise.resolve()
    : page.evaluate(`window.bench.look.followTo(${JSON.stringify(camera)}, ${Math.round(ms)})`).catch(() => undefined);

// 不等它做完：几帧以后页面自己报告做完了
const resettle = (page: Page) =>
  page.isClosed() ? Promise.resolve() : page.evaluate('void window.bench.look.resettle()').catch(() => undefined);

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
    console.log('拖动、右键转动、滚轮缩放任意一个窗口，其余的跟着它；停下后在任意一个窗口按 R，所有窗口在这个视角重新稳定再比。');
    console.log('关掉所有窗口或按 Ctrl+C 结束。各档的数字以 --at 的测量为准。');
    let known: (BenchCamera | null)[] = pages.map(() => null);
    let last: BenchCamera | null = null;
    let syncedAt = Date.now();
    // 上一轮页面报告在跟随（或重新稳定）：这一轮读到的终点和上一轮中途的位置不同，也是它自己走的
    let wasFollowing = pages.map(() => false);
    while (!ctx.stopping() && pages.some(page => !page.isClosed())) {
      // oxlint-disable-next-line no-await-in-loop -- 一轮一轮地同步
      const states = await Promise.all(pages.map(readState));
      const now = Date.now();
      const current = states.map(state => state?.camera ?? null);
      const driving = states.map(state => state?.driving === true);
      if (states.some(state => state?.resettle)) {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await Promise.all(pages.map(resettle));
        wasFollowing = pages.map(() => true);
        known = current;
        syncedAt = now;
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await sleep(SYNC_EVERY_MS);
        continue;
      }
      const busy = states.map((state, index) => !driving[index] && (state?.following === true || wasFollowing[index]));
      const { target, followers } = syncStep(current, ignoreBusy(known, current, busy), last, driving);
      if (target) {
        const ms = segmentMs(now - syncedAt);
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await Promise.all(
          followers
            .map(index => pages[index])
            .filter(page => page !== undefined)
            .map(page => follow(page, target, ms))
        );
        last = target;
      }
      wasFollowing = states.map((state, index) => state?.following === true || followers.includes(index));
      syncedAt = now;
      known = current;
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await sleep(SYNC_EVERY_MS);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
