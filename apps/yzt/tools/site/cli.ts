import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runCheck } from './check.ts';
import { findSite } from './compose.ts';
import { SiteError } from './errors.ts';
import { loadSites, SITES_FILE } from './sites.ts';

// 核对一台服务器上按站点发布的三维模型清单（ADR 0164）：在 apps/yzt 下运行 pnpm site:check <站点>，用法见 docs/commands.md

const HELP = `核对服务器上按站点发布的三维模型清单（ADR 0164，docs/config/3dt-manifest.md"按站点发布"）

用法：pnpm --filter yzt site:check <站点> [选项]

  <站点>            tools/site/sites.json 里的站点名
  --origin <地址>   前端的地址，如 http://192.168.15.111:5173；不写时用站点的 origin
  --suggest         探测全集里的每个模型（不只是这个站点该有的），打印这台服务器缺的模型，
                    可以抄进站点的 missing；新加服务器、数据有变化时用
  --timeout <秒>    每个请求的超时，默认 15
  --help、-h        显示这段说明

核对三件事，只读、不写文件：
  1. 服务器上的 /3dt/manifest.json 是不是这个站点的组合；不是时说出它等于全集、别的站点，还是都不是
  2. 每个模型的入口（tileset.json，白膜的每种效果，.lcc2 索引）能取到，不是 404、不是回退的网页
  3. 每个能取到的 LCC2 的第一个数据块发两段 Range：206、有 Content-Range、不压缩、两次的 ETag 相同（docs/deployment.md）
全部通过时退出码 0，否则 1
`;

function parseOptions(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        origin: { type: 'string' },
        suggest: { type: 'boolean', default: false },
        timeout: { type: 'string', default: '15' },
        help: { type: 'boolean', short: 'h', default: false }
      }
    });
  } catch (error) {
    throw new SiteError(error instanceof Error ? error.message : String(error));
  }
}

function isHttp(origin: string): boolean {
  return URL.canParse(origin) && ['http:', 'https:'].includes(new URL(origin).protocol);
}

async function main(): Promise<number> {
  const { values, positionals } = parseOptions(process.argv.slice(2));
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const sites = loadSites(SITES_FILE);
  if (positionals.length !== 1) {
    throw new SiteError(`要给一个站点名（现有 ${Object.keys(sites).join('、')}），现在是 ${positionals.length} 个；用法见 --help`);
  }
  const [siteName] = positionals;
  const site = findSite(siteName, sites);
  const origin = values.origin ?? site.origin;
  if (origin === undefined) {
    throw new SiteError(`站点 ${siteName} 没有写 origin，用 --origin <地址> 指定`);
  }
  if (!isHttp(origin)) {
    throw new SiteError(`--origin 要写成 http://主机:端口：${origin}`);
  }
  const timeout = Number(values.timeout);
  if (!(timeout > 0)) {
    throw new SiteError(`--timeout 要是大于 0 的秒数：${values.timeout}`);
  }
  const catalogText = readFileSync(resolve(import.meta.dirname, '../../public/3dt/manifest.json'), 'utf8');
  const passed = await runCheck({
    siteName,
    site,
    sites,
    catalogText,
    origin,
    suggest: values.suggest,
    timeout: timeout * 1000,
    log: line => console.log(line)
  });
  return passed ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  // 站点、清单、参数、网络不对时只打印一行原因；别的错是程序的问题，打印完整的错误和堆栈
  if (error instanceof SiteError) {
    console.error(`[site:check] ${error.message.replace(/^\[site\] /, '')}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
