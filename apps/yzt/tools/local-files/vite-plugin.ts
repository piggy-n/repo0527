import sirv from 'sirv';
import type { Plugin } from 'vite';

/** 映射的一个目录；fallthrough 为 false 时目录里没有的文件直接回 404，不交给后面的中间件 */
export interface LocalMount {
  readonly directory: string;
  readonly fallthrough: boolean;
}

/** 开发服务器把这些地址映射到未入库的目录，文件不放进 public，构建也就不会复制（ADR 0141）；只写目录时 fallthrough 为 true */
export function localFilesPlugin(mounts: Readonly<Record<string, string | LocalMount>>): Plugin {
  return {
    name: 'yzt:local-files',
    // 测试不读这些目录：用例只用自己的数据
    apply: (_config, { command, mode }) => command === 'serve' && mode !== 'test',
    configureServer(server) {
      for (const [url, mount] of Object.entries(mounts)) {
        const { directory, fallthrough } = typeof mount === 'string' ? { directory: mount, fallthrough: true } : mount;
        // 排在 Vite 的中间件之前，原型的脚本和样式不经过转换；dev 每次请求都查磁盘，放进新文件不用重启
        const serve = sirv(directory, { dev: true });
        // 目录里没有的文件交给后面的中间件，3DT 的清单就这样继续从 public 提供；
        // 不交时不传 next，sirv 才回 404，否则会被 Vite 改写成 index.html 并回 200（服务器底图靠 404 认缺瓦片，ADR 0165）
        server.middlewares.use(url, fallthrough ? serve : (req, res) => serve(req, res));
      }
    }
  };
}
