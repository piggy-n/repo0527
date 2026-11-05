// 一个浏览器、一个页面的小驱动：空闲 15 分钟或收到 /quit 自动退出，不留常驻进程
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5299;
const IDLE_MS = 15 * 60 * 1000;
const redact = text => String(text).replace(/tk=[^&\s"']+/g, 'tk=***');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
let page = await context.newPage();
let logs = [];
function bind(target) {
  target.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      logs.push(`${message.type()}: ${redact(message.text())}`.slice(0, 400));
    }
  });
  target.on('pageerror', error => logs.push(`pageerror: ${redact(error.message)}`.slice(0, 600)));
  target.on('crash', () => logs.push('page crashed'));
}
bind(page);

let timer;
function touch() {
  clearTimeout(timer);
  timer = setTimeout(quit, IDLE_MS);
}
async function quit() {
  server.close();
  await browser.close().catch(() => {});
  process.exit(0);
}

const handlers = {
  async goto({ url }) {
    logs = [];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    return { url: redact(page.url()) };
  },
  async eval({ code, timeoutMs = 300000 }) {
    const work = page.evaluate(`(async () => { ${code} })()`);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`eval timeout ${timeoutMs}`)), timeoutMs));
    return Promise.race([work, timeout]);
  },
  async shot({ path, clip }) {
    mkdirSync(dirname(path), { recursive: true });
    await page.screenshot({ path, clip, timeout: 120000, animations: 'allow' });
    return { path };
  },
  async mouse({ actions }) {
    for (const [kind, ...args] of actions) {
      if (kind === 'move') await page.mouse.move(...args);
      if (kind === 'down') await page.mouse.down();
      if (kind === 'up') await page.mouse.up();
      if (kind === 'click') await page.mouse.click(...args);
      if (kind === 'key') await page.keyboard.press(...args);
      if (kind === 'keydown') await page.keyboard.down(...args);
      if (kind === 'keyup') await page.keyboard.up(...args);
      if (kind === 'wait') await page.waitForTimeout(...args);
    }
    return { ok: true };
  },
  async logs({ clear }) {
    const out = logs.slice(-60);
    if (clear) {
      logs = [];
    }
    return { count: logs.length, out };
  },
  async cdpProfile({ code, timeoutMs = 120000 }) {
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');
    const before = await client.send('Performance.getMetrics');
    const value = await handlers.eval({ code, timeoutMs });
    const after = await client.send('Performance.getMetrics');
    const pick = metrics => Object.fromEntries(metrics.metrics.filter(m => ['JSHeapUsedSize', 'TaskDuration', 'ScriptDuration'].includes(m.name)).map(m => [m.name, m.value]));
    await client.detach();
    return { value, before: pick(before), after: pick(after) };
  },
  async quit() {
    setTimeout(quit, 50);
    return { quitting: true };
  }
};

const server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', async () => {
    touch();
    const name = req.url.slice(1);
    res.setHeader('Content-Type', 'application/json');
    try {
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`unknown ${name}`);
      }
      const result = await handler(body ? JSON.parse(body) : {});
      res.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      res.end(JSON.stringify({ ok: false, error: redact(error.message).slice(0, 1500) }));
    }
  });
});
server.listen(PORT, '127.0.0.1', () => {
  touch();
  console.log(`driver on ${PORT}`);
});
