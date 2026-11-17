import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { type ComposedManifest, composeSiteManifest, findSite, parseCatalog } from './compose.ts';
import { SiteError } from './errors.ts';
import { loadSites, type Site, SITES_FILE } from './sites.ts';

const MANIFEST = '3dt/manifest.json';

/**
 * 按站点发布三维模型清单（ADR 0164）：设了站点时，构建把全集按站点去掉缺的模型、写进产物的 3dt/manifest.json，
 * 开发服务器也用组合的结果回答清单的请求；没设时不改清单
 */
export function sitePlugin(siteName: string | undefined, sitesFile = SITES_FILE): Plugin {
  let config: ResolvedConfig;
  let written: { readonly file: string; readonly text: string } | undefined;

  // 每次都重新读全集和站点：开发服务器上改了不用重启。全集写坏时写明是哪个文件（parseCatalog 也读服务器上的清单，不知道文件名）
  const readCatalog = (): { text: string; total: number } => {
    const text = readFileSync(join(config.publicDir, MANIFEST), 'utf8');
    try {
      return { text, total: parseCatalog(text).length };
    } catch (error) {
      throw new SiteError(`${error instanceof Error ? error.message : String(error)}（public/${MANIFEST}）`, { cause: error });
    }
  };
  const compose = (name: string): { composed: ComposedManifest; site: Site } => {
    const site = findSite(name, loadSites(sitesFile));
    return { composed: composeSiteManifest(readCatalog().text, name, site), site };
  };

  return {
    name: 'yzt:site',
    // 测试只用自己的数据；vite preview 只提供已经构建好的产物，用不到
    apply: (_config, { mode, isPreview }) => mode !== 'test' && isPreview !== true,
    configResolved(resolved) {
      config = resolved;
      if (!siteName) {
        if (config.command === 'build') {
          config.logger.info(`[site] 没有设 YZT_SITE：三维模型清单发布全集 ${readCatalog().total} 个模型`);
        }
        return;
      }
      // 站点名、缺的模型写错时，打包之前就失败
      const {
        composed: { models, total },
        site
      } = compose(siteName);
      const reasons = site.missing.map(({ id, reason }) => `${id}（${reason}）`).join('、');
      config.logger.info(
        `[site] 站点 ${siteName}（${site.label}）：三维模型清单发布全集 ${total} 个中的 ${models.length} 个${reasons ? `，缺 ${reasons}` : ''}`
      );
    },
    writeBundle: {
      sequential: true,
      handler(options) {
        if (!siteName) {
          return;
        }
        // Vite 在 renderStart 时把 public 复制进产物，这里覆盖复制过来的全集
        const file = resolve(config.root, options.dir ?? config.build.outDir, MANIFEST);
        const { text } = compose(siteName).composed;
        writeFileSync(file, text);
        written = { file, text };
      }
    },
    closeBundle() {
      // 以后 Vite 改了复制 public 的时机，产物会被盖回全集：在这里发现
      if (written && readFileSync(written.file, 'utf8') !== written.text) {
        throw new SiteError(`[site] 产物里的 ${MANIFEST} 不是站点 ${siteName} 组合的结果，被别的步骤覆盖了`);
      }
    },
    configureServer(server) {
      if (!siteName) {
        return;
      }
      const url = `${config.base}${MANIFEST}`;
      // 直接注册，排在 Vite 的代理（YZT_3DT_PROXY）、本地文件和 public 之前：清单来自工作区，模型照旧从本地或服务器取
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== url) {
          next();
          return;
        }
        try {
          const { text } = compose(siteName).composed;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(text);
        } catch (error) {
          next(error);
        }
      });
    }
  };
}
