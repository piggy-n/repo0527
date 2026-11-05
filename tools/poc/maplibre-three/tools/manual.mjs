// 人工检查：pnpm manual。打开一个带链接的页面，关掉浏览器窗口后服务自动退出，最多留 90 分钟
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { startStaticServer } from './lib/file-server.mjs';
import { CESIUM_RUNTIME_DIR, LCC2_DIR, LCC_APP_DIR, MODELS_DIR, POC_DIR, ROAM_DIR } from './lib/paths.mjs';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
// 天地图的 key 通常只放行这个端口
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 5273;
const minutesIndex = args.indexOf('--minutes');
const minutes = minutesIndex >= 0 ? Number(args[minutesIndex + 1]) : 90;

function build(cwd, extraArgs = []) {
  const vite = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
  const outcome = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn', ...extraArgs], { cwd, stdio: 'inherit' });
  if (outcome.status !== 0) {
    process.exit(3);
  }
}

if (!args.includes('--skip-build')) {
  console.log('构建页面……');
  build(POC_DIR);
  if (existsSync(join(LCC_APP_DIR, 'node_modules'))) {
    build(LCC_APP_DIR, ['--base=/lcc2app/']);
  }
}

let server;
try {
  server = await startStaticServer(port, {
    '/lcc2app/': join(LCC_APP_DIR, 'dist'),
    '/3dt/': MODELS_DIR,
    '/roam/': ROAM_DIR,
    '/cesium/': CESIUM_RUNTIME_DIR,
    '/lcc2/': LCC2_DIR,
    '/': join(POC_DIR, 'dist')
  });
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 被占用，用 --port 换一个（换端口后天地图的 key 可能不放行）。` : error.message);
  process.exit(1);
}

const { browser } = await launchBrowser({ manual: true, headless: false, allowSoftware: args.includes('--allow-software'), viewport: { width: 1600, height: 900 } });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(`${server.url.replace('127.0.0.1', 'localhost')}/manual.html`);
console.log('已经打开手动检查页。看完关掉浏览器窗口就行。');

const finish = async () => {
  await server.close();
  process.exit(0);
};
setTimeout(() => void browser.close().catch(() => {}).then(finish), minutes * 60000);
browser.on('disconnected', () => void finish());
page.on('close', () => {
  if (context.pages().length === 0) {
    void browser.close().catch(() => {});
  }
});
