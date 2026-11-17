import { z } from 'zod';
import { SiteError } from './errors.ts';
import type { Site, Sites } from './sites.ts';

// 全集只校验组合要用的 id；完整的格式由 features/scene-models/api.ts 校验（依赖应用的别名，Node 里导入不了）
const catalogSchema = z.object({ models: z.array(z.looseObject({ id: z.string() })) });

export type CatalogModel = z.infer<typeof catalogSchema>['models'][number];

export interface ComposedManifest {
  /** 写进产物的清单文本 */
  readonly text: string;
  readonly models: readonly CatalogModel[];
  /** 全集的模型数 */
  readonly total: number;
}

const SITE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 解析三维模型清单的文本（全集或服务器上部署的），开头的 BOM 去掉；不是合法的 JSON、格式不对时抛错 */
export function parseCatalog(text: string): readonly CatalogModel[] {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new SiteError(`[site] 三维模型清单不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
  const parsed = catalogSchema.safeParse(data);
  if (!parsed.success) {
    throw new SiteError('[site] 三维模型清单的格式不对：要有 models 数组，每个模型有 id');
  }
  return parsed.data.models;
}

/** 按名字取站点；没有时抛错，列出现有的站点 */
export function findSite(name: string, sites: Sites): Site {
  if (!Object.hasOwn(sites, name)) {
    throw new SiteError(`[site] 没有站点 ${name}：现有 ${Object.keys(sites).join('、')}（tools/site/sites.json）`);
  }
  return sites[name];
}

/** 站点缺的模型 ID */
export function missingIds(site: Site): string[] {
  return site.missing.map(item => item.id);
}

/** 站点名和缺的 ID 有没有写错：名字只用小写字母、数字和连字符，缺的 ID 不重复、都在全集里 */
export function siteProblems(name: string, site: Site, catalog: readonly CatalogModel[]): string[] {
  const problems: string[] = [];
  if (!SITE_NAME.test(name)) {
    problems.push(`站点名 ${name} 只能用小写字母、数字和连字符`);
  }
  const ids = new Set(catalog.map(model => model.id));
  const seen = new Set<string>();
  for (const id of missingIds(site)) {
    if (seen.has(id)) {
      problems.push(`缺的模型 ${id} 写了两次`);
    } else if (!ids.has(id)) {
      problems.push(`缺的模型 ${id} 不在全集清单里`);
    }
    seen.add(id);
  }
  return problems;
}

/**
 * 全集按站点去掉缺的模型：先后不变，留下的模型原样保留；站点不缺模型时文本原样返回。
 * 站点名或缺的 ID 写错时抛错
 */
export function composeSiteManifest(catalogText: string, name: string, site: Site): ComposedManifest {
  const catalog = parseCatalog(catalogText);
  const problems = siteProblems(name, site, catalog);
  if (problems.length > 0) {
    throw new SiteError(`[site] 站点 ${name} 写错了：${problems.join('；')}（tools/site/sites.json）`);
  }
  if (site.missing.length === 0) {
    return { text: catalogText, models: catalog, total: catalog.length };
  }
  const missing = new Set(missingIds(site));
  const models = catalog.filter(model => !missing.has(model.id));
  return { text: `${JSON.stringify({ models }, null, 2)}\n`, models, total: catalog.length };
}
