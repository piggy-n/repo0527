import { debounce } from 'lodash-es';
import { relative, resolve, sep } from 'node:path';
import type { Logger, Plugin } from 'vite';
import { describeReport, type IconsOptions, type SyncReport, syncIcons } from './sync.ts';

/** 开发服务器启动、图标目录有变化、构建开始时，自动规范化图标并更新注册表；构建时有错误会失败 */
export function iconsPlugin(options: IconsOptions): Plugin {
  const dir = resolve(options.dir);
  let logger: Logger | undefined;
  let isBuild = false;

  const run = (): SyncReport => {
    const report = syncIcons(options, { write: true });
    for (const line of describeReport(report)) {
      logger?.info(`[icons] ${line}`);
    }
    return report;
  };

  // 监听回调里的异常会让开发服务器退出，这里只记录，不向外抛出
  const safeRun = () => {
    try {
      run();
    } catch (error) {
      logger?.error(`[icons] 处理图标失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    name: 'yzt:icons',
    configResolved(config) {
      ({ logger } = config);
      isBuild = config.command === 'build';
    },
    buildStart() {
      if (!isBuild) {
        safeRun();
        return;
      }
      const { errors } = run();
      if (errors.length) {
        this.error(`[icons] 图标目录中有无法处理的文件：\n${errors.join('\n')}`);
      }
    },
    configureServer(server) {
      server.watcher.add(dir);
      // 改名、写回文件会连续触发多个事件，合并成一次处理；再次处理时已没有变化
      const scheduleRun = debounce(safeRun, 100);
      const onChange = (file: string) => {
        const path = relative(dir, file);
        if (!path.startsWith('..') && !path.includes(sep) && path.toLowerCase().endsWith('.svg')) {
          scheduleRun();
        }
      };
      server.watcher.on('add', onChange);
      server.watcher.on('change', onChange);
      server.watcher.on('unlink', onChange);
    }
  };
}
