import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SiteError } from './errors.ts';

/**
 * 部署站点的文件：键是构建时 YZT_SITE 的取值（服务器 IP 的后两段），值是这台服务器缺哪些模型（ADR 0164）。
 * 插件用 fs 读、不 import：它不是 vite.config.ts 的依赖，改它时 test:changed 只选站点的测试
 */
export const SITES_FILE = join(import.meta.dirname, 'sites.json');

const missingSchema = z.strictObject({
  /** 全集清单里的模型 ID */
  id: z.string().min(1),
  /** 为什么缺：构建日志、site:check 里显示；数据补齐后连这一项一起删掉 */
  reason: z.string().min(1)
});

const siteSchema = z.strictObject({
  label: z.string().min(1),
  /** 前端的地址，site:check 默认检查它 */
  origin: z.url({ protocol: /^https?$/ }).optional(),
  missing: z.array(missingSchema)
});

export const sitesSchema = z.record(z.string(), siteSchema);

export type Site = z.infer<typeof siteSchema>;
export type Sites = z.infer<typeof sitesSchema>;

/** 解析部署站点的文件，开头的 BOM 去掉；不是合法的 JSON、格式不对时抛错 */
export function parseSites(text: string): Sites {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new SiteError(`[site] 部署站点的文件不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
  const parsed = sitesSchema.safeParse(data);
  if (!parsed.success) {
    throw new SiteError(`[site] 部署站点的文件格式不对（tools/site/sites.json）：\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** 读部署站点的文件（默认 tools/site/sites.json） */
export function loadSites(file = SITES_FILE): Sites {
  return parseSites(readFileSync(file, 'utf8'));
}
