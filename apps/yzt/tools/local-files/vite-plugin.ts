import sirv from 'sirv';
import type { Plugin } from 'vite';

/** 开发服务器把这些地址映射到未入库的目录，文件不放进 public，构建也就不会复制（ADR 0141） */
export function localFilesPlugin(mounts: Readonly<Record<string, string>>): Plugin {
  return {
    name: 'yzt:local-files',
    // 测试不读这些目录：用例只用自己的数据
    apply: (_config, { command, mode }) => command === 'serve' && mode !== 'test',
    configureServer(server) {
      for (const [url, directory] of Object.entries(mounts)) {
        // 排在 Vite 的中间件之前，原型的脚本和样式不经过转换；dev 每次请求都查磁盘，放进新文件不用重启。
        // 目录里没有的文件交给后面的中间件，3DT 的清单就这样继续从 public 提供
        server.middlewares.use(url, sirv(directory, { dev: true }));
      }
    }
  };
}
