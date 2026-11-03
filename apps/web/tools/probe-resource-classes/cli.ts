import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type EnumerateTarget,
  ProbeAuthError,
  type ProbeIO,
  type ProbeOptions,
  runEnumerate,
  runProbe,
  type TilesetProbe
} from './probe.ts';
import {
  candidateRows,
  exactFieldsOf,
  formatSummary,
  type ResourceSummary,
  slicingRows,
  summarizeResource,
  toCsv
} from './report.ts';
import { formatTileCheck, parseTileCheckTargets, runTileCheck, type TileCheckResult } from './tile-check.ts';

// 探查资源的分类字段（docs/commands.md）：只读请求后端，结果写到 --out；token 从环境变量读，不写进任何输出

const HELP = `用法：
  YZT_PROBE_TOKEN=<token> node tools/probe-resource-classes/cli.ts --base-url=http://<后端>:18010 [选项]

token 在浏览器登录系统后取：开发者工具的控制台运行 JSON.parse(localStorage.getItem('yzt.session')).token

选项：
  --base-url=<地址>     后端地址，不带 /backend（也可以用环境变量 YZT_PROBE_BASE_URL）
  --codes=<a,b>         只探查这些资源，默认全部
  --years=all|latest    探查哪些年份，默认 all（--tile-check 默认 latest）
  --zooms=<7,9,11,14>   抽样的瓦片级别，默认 7,9,11,14（--tile-check 默认 6～12）；重的资源自动跳过低级别
  --concurrency=<2>     同时探查几个瓦片集，默认 2；后端共用，不要开太大
  --exact               查候选字段的准确分布（每个取值一次 COUNT），只在最新一年、不超过 --exact-limit 的表上查
  --exact-limit=<500000>
  --enumerate=<a:f,b:g> 枚举资源 a 的字段 f、资源 b 的字段 g 的全部取值，确认图例列全了；只做这一件事，
                        结果写到 distinct-values.json；可以和 --years 一起用
  --tile-check=<a,b:f>  解码这些资源各级别瓦片的几何，判断是不是把要素合并成了一个，查同一级别颜色不一致；
                        只做这一件事，结果写到 tile-check.md、tile-check.json。a 按分类规则的字段，b 按字段 f，
                        rules 是全部有分类规则的资源（请求多，先查几个）
  --tiles-per-zoom=<25> --tile-check 一个级别最多查多少张瓦片，放得下时查覆盖全省的整个网格
  --out=<目录>          输出目录，默认 probe-resource-classes.local（不入库）
  --timeout=<120>       单个请求的上限（秒），超时不重试；枚举千万行的表时调大
  --refresh             不用缓存，重新请求
  --help`;

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    codes: { type: 'string' },
    years: { type: 'string' },
    zooms: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    exact: { type: 'boolean', default: false },
    'exact-limit': { type: 'string', default: '500000' },
    enumerate: { type: 'string' },
    'tile-check': { type: 'string' },
    'tiles-per-zoom': { type: 'string', default: '25' },
    out: { type: 'string', default: 'probe-resource-classes.local' },
    refresh: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '120' },
    help: { type: 'boolean', default: false }
  }
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const baseUrl = (values['base-url'] ?? process.env.YZT_PROBE_BASE_URL)?.replace(/\/+$/, '');
const token = process.env.YZT_PROBE_TOKEN;
if (!baseUrl || !token) {
  console.error('[probe] 要给出 --base-url（或 YZT_PROBE_BASE_URL）和环境变量 YZT_PROBE_TOKEN，见 --help');
  process.exit(1);
}
const tileCheck = values['tile-check'];
const years = values.years ?? (tileCheck ? 'latest' : 'all');
if (years !== 'all' && years !== 'latest') {
  console.error('[probe] --years 只能是 all 或 latest');
  process.exit(1);
}
const zooms = values.zooms ?? (tileCheck ? '6,7,8,9,10,11,12' : '7,9,11,14');

const out = resolve(values.out);
const rawDir = join(out, 'raw');
mkdirSync(rawDir, { recursive: true });

const options: ProbeOptions = {
  baseUrl,
  token,
  codes: values.codes ? new Set(values.codes.split(',').map(code => code.trim())) : null,
  years,
  zooms: zooms.split(',').map(Number),
  concurrency: Number(values.concurrency),
  exact: values.exact,
  exactLimit: Number(values['exact-limit']),
  refresh: values.refresh,
  timeoutSeconds: Number(values.timeout)
};

const io: ProbeIO = {
  fetch: globalThis.fetch,
  sleep: milliseconds => sleep(milliseconds),
  log: message => console.log(message),
  load: tileset => {
    const file = join(rawDir, `${tileset}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as TilesetProbe) : null;
  },
  save: probe => writeFileSync(join(rawDir, `${probe.tileset}.json`), JSON.stringify(probe))
};

// report.json 的一个资源：完整的评估结果，不含抽样的原始统计（在 raw/ 里）
function compactSummary({ resource, status, currentField, primary, assessed, latest }: ResourceSummary) {
  return {
    ...resource,
    status,
    currentField,
    primaryField: primary?.field ?? null,
    latestYear: latest?.year ?? null,
    labels: latest?.labels ?? {},
    exact: latest?.exact ?? {},
    assessed
  };
}

function enumerateTargets(text: string): EnumerateTarget[] {
  return text.split(',').map(item => {
    const [code, field] = item.trim().split(':');
    if (!code || !field) {
      throw new Error(`--enumerate 的写法是 资源:字段，收到 ${item}`);
    }
    return { code, field: field.toLowerCase() };
  });
}

// 每查完一个瓦片集写一次：查得久，中断时已查完的结果还在
function saveTileCheck(results: readonly TileCheckResult[], tilesPerZoom: number): void {
  writeFileSync(join(out, 'tile-check.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(out, 'tile-check.md'), formatTileCheck(results, tilesPerZoom));
}

try {
  if (tileCheck) {
    const tilesPerZoom = Number(values['tiles-per-zoom']);
    await runTileCheck(
      parseTileCheckTargets(tileCheck),
      { ...options, tilesPerZoom },
      { ...io, save: results => saveTileCheck(results, tilesPerZoom) }
    );
    console.log(`[probe] 完成，结果在 ${join(out, 'tile-check.md')}`);
    process.exit(0);
  }
  if (values.enumerate) {
    const results = await runEnumerate(enumerateTargets(values.enumerate), options, io);
    writeFileSync(join(out, 'distinct-values.json'), JSON.stringify(results, null, 2));
    console.log(`[probe] 完成，结果在 ${join(out, 'distinct-values.json')}`);
    process.exit(0);
  }
  const result = await runProbe(options, io, exactFieldsOf);
  const summaries = result.resources.map(resource => summarizeResource(resource, result.probes));
  writeFileSync(join(out, 'candidates.csv'), toCsv(candidateRows(summaries)));
  writeFileSync(join(out, 'slicing-requirements.csv'), toCsv(slicingRows(summaries)));
  writeFileSync(join(out, 'summary.md'), formatSummary(result, summaries));
  const report = { failures: result.failures, resources: summaries.map(compactSummary) };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[probe] 完成，结果在 ${out}；网络失败 ${result.failures.length} 个`);
} catch (error) {
  if (error instanceof ProbeAuthError) {
    console.error(`[probe] ${error.message}`);
  } else {
    console.error('[probe] 探查失败：', error);
  }
  process.exit(1);
}
