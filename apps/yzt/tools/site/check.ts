import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { type CatalogModel, composeSiteManifest, missingIds, parseCatalog } from './compose.ts';
import { SiteError } from './errors.ts';
import type { Site, Sites } from './sites.ts';

// 对一台服务器核对按站点发布的清单（ADR 0164）：部署的清单是不是这个站点的组合、每个模型的入口在不在、
// LCC2 的数据块是否支持 Range（docs/deployment.md"LCC2（高斯泼溅）模型的转发"）。只读，不写文件

const entrySchema = z.looseObject({
  id: z.string(),
  tileset: z.string().optional(),
  lcc2: z.string().optional(),
  effects: z.array(z.looseObject({ id: z.string(), tileset: z.string() })).optional()
});

const indexSchema = z.looseObject({ root: z.looseObject({ splatFiles: z.array(z.string()).min(1) }) });

export interface Entry {
  /** 模型 ID，白膜是 模型ID/效果ID */
  readonly label: string;
  /** 相对清单的地址，和清单里一样按段编码 */
  readonly path: string;
  readonly lcc2: boolean;
}

/** 模型的入口文件：瓦片集的 tileset.json（白膜每种效果一个）、高斯泼溅的 .lcc2 索引 */
export function entriesOf(model: CatalogModel): Entry[] {
  const parsed = entrySchema.safeParse(model);
  if (!parsed.success) {
    return [];
  }
  const { id, tileset, lcc2, effects } = parsed.data;
  const entries: Entry[] = (effects ?? []).map(effect => ({ label: `${id}/${effect.id}`, path: effect.tileset, lcc2: false }));
  if (tileset !== undefined) {
    entries.push({ label: id, path: tileset, lcc2: false });
  }
  if (lcc2 !== undefined) {
    entries.push({ label: id, path: lcc2, lcc2: true });
  }
  return entries;
}

/** 清单的地址：前端部署在 origin 下，清单在它的 3dt/manifest.json */
export function manifestUrl(origin: string): URL {
  return new URL('3dt/manifest.json', origin.endsWith('/') ? origin : `${origin}/`);
}

export interface ManifestDiff {
  readonly onlyOnServer: readonly string[];
  readonly onlyExpected: readonly string[];
  /** 两边都有、字段不同的模型和不同的字段 */
  readonly changed: readonly { readonly id: string; readonly keys: readonly string[] }[];
}

/** 服务器上的清单和这个站点的组合差在哪里 */
export function diffModels(server: readonly CatalogModel[], expected: readonly CatalogModel[]): ManifestDiff {
  const serverById = new Map(server.map(model => [model.id, model]));
  const expectedIds = new Set(expected.map(model => model.id));
  const changed: { id: string; keys: string[] }[] = [];
  for (const model of expected) {
    const other = serverById.get(model.id);
    if (other === undefined) {
      continue;
    }
    const keys = [...new Set([...Object.keys(model), ...Object.keys(other)])].filter(
      key => !isDeepStrictEqual(model[key], other[key])
    );
    if (keys.length > 0) {
      changed.push({ id: model.id, keys });
    }
  }
  return {
    onlyOnServer: server.filter(model => !expectedIds.has(model.id)).map(model => model.id),
    onlyExpected: expected.filter(model => !serverById.has(model.id)).map(model => model.id),
    changed
  };
}

export interface Candidate {
  /** "全集"或站点名 */
  readonly name: string;
  readonly models: readonly CatalogModel[];
}

/** 服务器上的清单等于哪几份（全集、各个站点的组合） */
export function identify(server: readonly CatalogModel[], candidates: readonly Candidate[]): string[] {
  return candidates.filter(candidate => isDeepStrictEqual(candidate.models, server)).map(candidate => candidate.name);
}

export interface RangeReply {
  readonly status: number;
  readonly contentRange: string | null;
  readonly contentEncoding: string | null;
  readonly etag: string | null;
}

/** 文件的总字节数，取自 Content-Range（bytes 0-4095/4297496） */
export function totalBytes(contentRange: string | null): number | null {
  const match = /\/(\d+)$/.exec(contentRange ?? '');
  return match ? Number(match[1]) : null;
}

const MB = 1048576;

/** 第二段 Range：落在和第一段不同的 1 MB 分片里（nginx 按 1 MB 分片缓存时要从上游取），文件小时取中间 */
export function secondRange(total: number): string | null {
  if (total <= 8192) {
    return null;
  }
  let start = Math.floor(total / 2);
  if (total > 2 * MB + 4096) {
    start = 2 * MB;
  } else if (total > MB + 4096) {
    start = MB;
  }
  return `bytes=${start}-${Math.min(start + 4095, total - 1)}`;
}

/** 按 deployment.md 的要求核对两次 Range 的响应：206、有 Content-Range、不压缩、ETag 相同 */
export function rangeProblems(first: RangeReply, second: RangeReply | null): string[] {
  const problems: string[] = [];
  for (const [name, reply] of [
    ['第一段', first],
    ['第二段', second]
  ] as const) {
    if (reply === null) {
      continue;
    }
    if (reply.status === 200) {
      problems.push(`${name}返回 200，不是 206：库会把整个文件下载下来`);
    } else if (reply.status !== 206) {
      problems.push(`${name}返回 ${reply.status}：取不到数据块，这个模型加载失败`);
    }
    if (reply.status === 206 && !reply.contentRange) {
      problems.push(`${name}没有 Content-Range`);
    }
    if (reply.contentEncoding && reply.contentEncoding !== 'identity') {
      problems.push(`${name}压缩了（Content-Encoding: ${reply.contentEncoding}）：库不用 Range`);
    }
  }
  if (second !== null && first.etag !== second.etag) {
    problems.push(`两段的 ETag 不同（${first.etag ?? '无'}、${second.etag ?? '无'}）：数据块会加载失败`);
  }
  return problems;
}

/** 请求失败的原因：fetch 把真正的原因放在 cause 里，一个主机名解析出几个地址时是 AggregateError、message 可能是空的 */
export function reason(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause instanceof Error ? error.cause : error;
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    return cause.errors.map(item => reason(item)).join('；');
  }
  if (cause.message) {
    return cause.message;
  }
  if ('code' in cause && typeof cause.code === 'string') {
    return cause.code;
  }
  return error.message || error.name;
}

export interface CheckOptions {
  readonly siteName: string;
  readonly site: Site;
  readonly sites: Sites;
  readonly catalogText: string;
  readonly origin: string;
  /** 探测全集里的每个模型，打印这台服务器缺的模型 */
  readonly suggest: boolean;
  /** 每个请求的超时（毫秒） */
  readonly timeout: number;
  readonly log: (line: string) => void;
}

async function request(url: URL, init: RequestInit, timeout: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}

/** 入口的结果：取到了；服务器上没有（404、回退成网页）；没法判断（别的状态码、请求失败） */
type Probe = { readonly kind: 'ok' } | { readonly kind: 'absent' | 'unknown'; readonly text: string };

// GET 只读响应头就断开，不下载内容
async function probe(url: URL, timeout: number): Promise<Probe> {
  try {
    const response = await request(url, { method: 'GET' }, timeout);
    await response.body?.cancel();
    if (response.status === 404) {
      return { kind: 'absent', text: 'HTTP 404' };
    }
    if (!response.ok) {
      return { kind: 'unknown', text: `HTTP ${response.status}` };
    }
    if (response.headers.get('content-type')?.startsWith('text/html')) {
      return { kind: 'absent', text: '返回的是网页（nginx 回退成了 index.html）' };
    }
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'unknown', text: `请求失败：${reason(error)}` };
  }
}

async function rangeReply(url: URL, range: string, timeout: number): Promise<RangeReply> {
  const response = await request(url, { headers: { Range: range } }, timeout);
  await response.body?.cancel();
  return {
    status: response.status,
    contentRange: response.headers.get('content-range'),
    contentEncoding: response.headers.get('content-encoding'),
    etag: response.headers.get('etag')
  };
}

// 取索引里的第一个数据块，按 deployment.md 的验收发两段 Range；返回要打印的一行
async function checkRange(indexUrl: URL, label: string, timeout: number): Promise<{ ok: boolean; line: string }> {
  try {
    const response = await request(indexUrl, {}, timeout);
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, line: `  ✗ ${label}：索引 HTTP ${response.status}` };
    }
    const index = indexSchema.safeParse(await response.json());
    if (!index.success) {
      return { ok: false, line: `  ✗ ${label}：索引里没有 root.splatFiles` };
    }
    const file = index.data.root.splatFiles[0];
    const block = new URL(file, indexUrl);
    const first = await rangeReply(block, 'bytes=0-4095', timeout);
    const total = totalBytes(first.contentRange);
    const range = total === null ? null : secondRange(total);
    const second = range === null ? null : await rangeReply(block, range, timeout);
    const problems = rangeProblems(first, second);
    if (problems.length > 0) {
      return { ok: false, line: `  ✗ ${label} 的 ${file}：${problems.join('；')}` };
    }
    const etag = first.etag === null ? '，两段都没有 ETag' : '，两段的 ETag 相同';
    const ranges = second ? `${first.contentRange}、${second.contentRange}` : first.contentRange;
    return { ok: true, line: `  ✓ ${label} 的 ${file}：206，${ranges}，不压缩${etag}` };
  } catch (error) {
    return { ok: false, line: `  ✗ ${label}：${reason(error)}` };
  }
}

function candidatesOf(options: CheckOptions, catalog: readonly CatalogModel[]): Candidate[] {
  const candidates: Candidate[] = [{ name: '全集', models: catalog }];
  for (const [name, site] of Object.entries(options.sites)) {
    try {
      candidates.push({ name: `站点 ${name}`, models: composeSiteManifest(options.catalogText, name, site).models });
    } catch {
      // 写错的站点在 sites.test.ts 里拦，这里不用它比
    }
  }
  return candidates;
}

// 部署的清单：是不是这个站点的组合，不是时说出它等于哪一份、差在哪里
async function checkManifest(options: CheckOptions, expected: readonly CatalogModel[], catalog: readonly CatalogModel[]): Promise<boolean> {
  const { siteName, timeout, log } = options;
  const manifest = manifestUrl(options.origin);
  let response: Response;
  try {
    response = await request(manifest, {}, timeout);
  } catch (error) {
    throw new SiteError(`连不上 ${manifest.origin}：${reason(error)}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    log(`  ✗ HTTP ${response.status}`);
    return false;
  }
  let deployed: readonly CatalogModel[];
  try {
    deployed = parseCatalog(await response.text());
  } catch (error) {
    log(`  ✗ 读不了：${reason(error)}`);
    return false;
  }
  if (isDeepStrictEqual(deployed, expected)) {
    log(`  ✓ 就是站点 ${siteName} 的组合（${deployed.length} 个模型）`);
    return true;
  }
  const matches = identify(deployed, candidatesOf(options, catalog));
  log(
    `  ✗ 不是站点 ${siteName} 的组合：${matches.length > 0 ? `它等于${matches.join('、')}` : '不等于全集，也不等于任何站点（可能是旧版本，要重新发布前端）'}`
  );
  const diff = diffModels(deployed, expected);
  if (diff.onlyOnServer.length > 0) {
    log(`    服务器上多出：${diff.onlyOnServer.join('、')}`);
  }
  if (diff.onlyExpected.length > 0) {
    log(`    服务器上少了：${diff.onlyExpected.join('、')}`);
  }
  for (const { id, keys } of diff.changed) {
    log(`    ${id} 的 ${keys.join('、')} 不同`);
  }
  if (diff.onlyOnServer.length + diff.onlyExpected.length + diff.changed.length === 0) {
    log('    模型一样，先后不同');
  }
  return false;
}

/** 核对一台服务器，逐行打印结果；全部通过时返回 true */
export async function runCheck(options: CheckOptions): Promise<boolean> {
  const { siteName, site, timeout, log } = options;
  const catalog = parseCatalog(options.catalogText);
  const expected = composeSiteManifest(options.catalogText, siteName, site);
  const manifest = manifestUrl(options.origin);
  const missing = new Set(missingIds(site));
  let ok = true;

  log(`站点 ${siteName}（${site.label}），清单 ${manifest.href}`);
  const reasons = site.missing.map(item => `${item.id}（${item.reason}）`).join('、');
  log(`应当发布全集 ${expected.total} 个中的 ${expected.models.length} 个${reasons ? `，缺 ${reasons}` : ''}`);

  log('');
  log('== 部署的清单');
  if (!(await checkManifest(options, expected.models, catalog))) {
    ok = false;
  }

  log('');
  log(options.suggest ? '== 全集里每个模型的入口' : '== 每个模型的入口');
  const models = options.suggest ? catalog : expected.models;
  for (const model of models.filter(item => entriesOf(item).length === 0)) {
    log(`  ✗ ${model.id}：清单里没有入口（tileset、effects、lcc2）`);
    ok = false;
  }
  // 一起请求、按清单的先后打印：服务器慢或者连不上时不用逐个等超时
  const targets = models.flatMap(model => entriesOf(model).map(entry => ({ model, entry, url: new URL(entry.path, manifest) })));
  const probes = await Promise.all(targets.map(({ url }) => probe(url, timeout)));
  const absent: string[] = [];
  const undecided: string[] = [];
  const splats: { url: URL; label: string }[] = [];
  for (const [index, { model, entry, url }] of targets.entries()) {
    const result = probes[index];
    const path = decodeURIComponent(entry.path);
    if (result.kind === 'ok') {
      log(`  ✓ ${entry.label}  ${path}`);
      if (entry.lcc2) {
        splats.push({ url, label: entry.label });
      }
      continue;
    }
    const list = result.kind === 'absent' ? absent : undecided;
    if (!list.includes(model.id)) {
      list.push(model.id);
    }
    // --suggest 时站点已经写了缺的模型取不到是对的，不算没通过
    if (options.suggest && missing.has(model.id) && result.kind === 'absent') {
      log(`  － ${entry.label}：站点写了缺（${result.text}）  ${path}`);
      continue;
    }
    log(`  ✗ ${entry.label}：${result.kind === 'unknown' ? `没法判断，${result.text}` : result.text}  ${path}`);
    ok = false;
  }
  if (options.suggest) {
    log('');
    const probed = models.filter(model => entriesOf(model).length > 0).length;
    if (probed > 0 && absent.length === probed) {
      log('全集里的模型在这台服务器上都取不到：先检查 nginx 的 /3dt/ alias 和模型目录，不要把它们都写进 missing');
    } else {
      const suggestion = absent.map(id => ({ id, reason: site.missing.find(item => item.id === id)?.reason ?? '原因' }));
      log(`这台服务器缺的模型（入口 404 或回退成网页），可以写进 tools/site/sites.json 的 missing，原因要改成真实的：${JSON.stringify(suggestion)}`);
      const supplied = [...missing].filter(id => !absent.includes(id) && !undecided.includes(id));
      if (supplied.length > 0) {
        log(`站点写了缺、服务器上却都能取到：${supplied.join('、')}（数据补齐了的话从 missing 删掉）`);
      }
    }
    if (undecided.length > 0) {
      log(`没法判断的模型（别的状态码、请求失败），没有算进上面：${undecided.join('、')}`);
    }
  }

  log('');
  log('== LCC2 的 Range（每个能取到的 LCC2 的第一个数据块）');
  if (splats.length === 0) {
    log('  没有能取到的 LCC2，跳过');
  }
  const ranges = await Promise.all(splats.map(({ url, label }) => checkRange(url, label, timeout)));
  for (const { ok: passed, line } of ranges) {
    log(line);
    if (!passed) {
      ok = false;
    }
  }

  log('');
  log(ok ? '检查通过' : '检查没有通过，见上面带 ✗ 的行');
  return ok;
}
