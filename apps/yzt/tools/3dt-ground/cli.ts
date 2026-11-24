import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { coarseContent, type Fetcher } from './coarse.ts';
import { ToolError } from './errors.ts';
import { estimateGround, fromEcef, type GroundEstimate } from './ground.ts';

// 给清单里的模型估计贴地的参照（ADR 0170）：在 apps/yzt 下运行 pnpm 3dt:ground，用法见 docs/commands.md

const HELP = `估计三维模型贴地的参照点（ADR 0170，docs/config/3dt-manifest.md"贴地的参照"）

用法：pnpm --filter yzt 3dt:ground [模型 ID ...] [选项]

  [模型 ID]          只看这些模型；不写时看入库清单里的全部倾斜摄影、白膜和高斯泼溅
  --origin <地址>    模型所在服务器的前端地址，如 http://192.168.15.111:5173（读 <地址>/3dt/ 下的模型）；
                     不写时用环境变量 YZT_3DT_PROXY
  --limit <块数>     最粗一级最多读几块内容，默认 16
  --timeout <秒>     每个请求的超时，默认 30
  --help、-h         显示这段说明

只读、不写文件。瓦片集读最粗一级内容的顶点，取低的一半里按 1 米分档最多的那一档当地面，打印建议的 ground 和高度分布；
高斯泼溅不自己估（墓葬的包围盒底是墓底），在某个倾斜摄影的范围里时建议用它的地面点。室内、地下的模型不贴地，跳过。
最后打印一段 JSON（模型 ID → ground），人核对过再抄进 public/3dt/manifest.json
`;

interface ManifestModel {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly underground: boolean;
  readonly tileset?: string;
  readonly effects?: readonly { readonly tileset: string }[];
  readonly placement?: { readonly lng: number; readonly lat: number };
}

function parseOptions(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        origin: { type: 'string' },
        limit: { type: 'string', default: '16' },
        timeout: { type: 'string', default: '30' },
        help: { type: 'boolean', short: 'h', default: false }
      }
    });
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error));
  }
}

function httpFetcher(timeout: number): Fetcher {
  const get = async (url: string) => {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      throw new ToolError(`请求 ${url} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return response;
  };
  return {
    json: async url => {
      const response = await get(url);
      if (!response.ok) {
        throw new ToolError(`${url}：HTTP ${response.status}`);
      }
      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ToolError(`${url} 不是 JSON（服务器上可能没有这个模型，回退成了网页）`);
      }
    },
    bytes: async url => {
      const response = await get(url);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new ToolError(`${url}：HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

const fixed = (value: number, digits: number) => Number(value.toFixed(digits));

const groundOf = ({ lng, lat, height }: GroundEstimate) => ({
  lng: fixed(lng, 7),
  lat: fixed(lat, 7),
  height: fixed(height, 2)
});

interface Estimated {
  readonly model: ManifestModel;
  readonly estimate: GroundEstimate;
  // 顶点的经纬度范围：判断泼溅在不在它里面
  readonly extent: readonly [number, number, number, number];
}

async function estimateTileset(
  model: ManifestModel,
  base: string,
  fetcher: Fetcher,
  limit: number
): Promise<Estimated> {
  const path = model.tileset ?? model.effects?.[0]?.tileset;
  if (!path) {
    throw new ToolError(`${model.id} 没有瓦片集`);
  }
  const { contents, points, skipped } = await coarseContent(new URL(path, base).href, fetcher, limit);
  if (skipped.length > 0) {
    console.log(`  读不了的：${[...new Set(skipped)].join('；')}`);
  }
  const estimate = estimateGround(points);
  // 顶点可能有几十万个：不展开成参数
  const extent: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of points) {
    const [lng, lat] = fromEcef(point);
    extent[0] = Math.min(extent[0], lng);
    extent[1] = Math.min(extent[1], lat);
    extent[2] = Math.max(extent[2], lng);
    extent[3] = Math.max(extent[3], lat);
  }
  const [low, p5, p25, median, high] = estimate.spread.map(value => value.toFixed(1));
  console.log(`  读了最粗一级的 ${contents} 块、${points.length} 个顶点；高度 最低 ${low}、5% ${p5}、25% ${p25}、中位 ${median}、最高 ${high}`);
  console.log(`  建议 "ground": ${JSON.stringify(groundOf(estimate))}`);
  return { model, estimate, extent };
}

// 经纬度在不在顶点的范围里
function contains([west, south, east, north]: Estimated['extent'], lng: number, lat: number): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

async function main(): Promise<number> {
  const { values, positionals } = parseOptions(process.argv.slice(2));
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const origin = values.origin ?? process.env.YZT_3DT_PROXY;
  if (!origin || !URL.canParse(origin)) {
    throw new ToolError('要用 --origin 给出模型所在服务器的地址（或者设 YZT_3DT_PROXY），见 --help');
  }
  const limit = Number(values.limit);
  const timeout = Number(values.timeout);
  if (!(Number.isInteger(limit) && limit > 0) || !(timeout > 0)) {
    throw new ToolError('--limit 要是正整数，--timeout 要是大于 0 的秒数');
  }
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/3dt/manifest.json'), 'utf8')) as {
    models: ManifestModel[];
  };
  const unknown = positionals.filter(id => !manifest.models.some(model => model.id === id));
  if (unknown.length > 0) {
    throw new ToolError(`清单里没有 ${unknown.join('、')}`);
  }
  const chosen = manifest.models.filter(model => positionals.length === 0 || positionals.includes(model.id));
  const base = new URL('/3dt/', origin).href;
  const fetcher = httpFetcher(timeout * 1000);
  const estimated: Estimated[] = [];
  let failed = 0;
  for (const model of chosen.filter(item => item.kind !== 'splat')) {
    console.log(`${model.id} ${model.name}（${model.kind}）`);
    if (model.kind === 'indoor' || model.underground) {
      console.log('  室内、地下的模型不贴地，跳过');
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- 一个模型一个模型地读，输出按顺序
      estimated.push(await estimateTileset(model, base, fetcher, limit));
    } catch (error) {
      if (!(error instanceof ToolError)) {
        throw error;
      }
      failed++;
      console.log(`  失败：${error.message}`);
    }
  }
  const suggestions: Record<string, ReturnType<typeof groundOf>> = Object.fromEntries(
    estimated.map(({ model, estimate }) => [model.id, groundOf(estimate)])
  );
  for (const model of chosen.filter(item => item.kind === 'splat')) {
    const at = model.placement;
    const host = at ? estimated.find(({ extent }) => contains(extent, at.lng, at.lat)) : undefined;
    console.log(`${model.id} ${model.name}（splat）`);
    if (host) {
      console.log(`  在 ${host.model.id} ${host.model.name} 的范围里：同一处的模型要用同一个地面点`);
      suggestions[model.id] = groundOf(host.estimate);
    } else {
      console.log('  附近没有读到的倾斜摄影：不建议自己估，先不写（这次没读的模型可以一起列在参数里再看）');
    }
  }
  console.log('\n建议（核对过再抄进 public/3dt/manifest.json 的 ground）：');
  console.log(JSON.stringify(suggestions, null, 2));
  return failed > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof ToolError) {
    console.error(`[3dt:ground] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
