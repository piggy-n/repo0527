// 命令行参数：pnpm --filter yzt measure:3d 后面的参数原样传进来

export const HELP = `MapLibre 引擎和 Cesium 的性能对比（ADR 0147 3C.4），在显卡机器上运行

用法：pnpm --filter yzt measure:3d [选项]

  --only <列表>          只跑部分场景，逗号分隔、按子串匹配，如 --only z19 或 --only jkq2
                         默认只跑验收场景（倾斜摄影 z17、z19）；jkq、jkq2 要设环境变量 YZT_3DT_PROXY 指向服务器
  --list                 列出所有场景后退出
  --repeat <n>           perf 每个场景跑几遍（默认 3），报告取中位数
  --upload-mb <列表>     MapLibre 另外对照的上传预算，off 是不提前上传（默认 off），如 off,16,64
  --basemap <arcgis|none> 底图（默认 arcgis，两个引擎相同），没网时用 none
  --viewport <宽x高>     视口（默认 1600x900）
  --pacing <n>           在路上的帧数上限：1 是 PoC 的做法（默认 2），0 是不等
  --antialias            MapLibre 打开多重采样（默认和产品一样不开），和 Cesium 比边缘时用
  --out <目录>           结果写到这里（默认 local/measure-3d/<时间>）
  --port <n>             本地服务的端口（默认 5283）
  --load-timeout <秒>    等模型稳定的上限（默认 120）
  --skip-build           不重新构建，用上一次的页面
  --headless             无头模式；只有确认它走真实显卡时才用
  --allow-software       允许软件渲染，结果标为无效，只用来确认脚本能跑
  --quick                缩短每段的时长，只用来确认脚本能跑
  --help                 显示这段说明
`;

export interface Options {
  readonly only: readonly string[];
  readonly list: boolean;
  readonly repeat: number;
  /** 另外对照的上传预算（MB），null 是不提前上传 */
  readonly uploadMBs: readonly (number | null)[];
  readonly basemap: 'arcgis' | 'none';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly pacing: number;
  readonly antialias: boolean;
  readonly out: string | null;
  readonly port: number;
  readonly loadTimeoutMs: number;
  readonly skipBuild: boolean;
  readonly headless: boolean;
  readonly allowSoftware: boolean;
  readonly quick: boolean;
  readonly help: boolean;
}

function positive(name: string, text: string): number {
  const value = Number(text);
  if (!(value > 0)) {
    throw new Error(`参数 ${name} 要是正数：${text}`);
  }
  return value;
}

export function parseOptions(argv: readonly string[]): Options {
  const options: { -readonly [K in keyof Options]: Options[K] } = {
    only: [],
    list: false,
    repeat: 3,
    uploadMBs: [null],
    basemap: 'arcgis',
    viewport: { width: 1600, height: 900 },
    pacing: 2,
    antialias: false,
    out: null,
    port: 5283,
    loadTimeoutMs: 120000,
    skipBuild: false,
    headless: false,
    allowSoftware: false,
    quick: false,
    help: false
  };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const next = (): string => {
      index++;
      const value = argv[index];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`参数 ${name} 后面要写一个值`);
      }
      return value;
    };
    switch (name) {
      case '--':
        break;
      case '--only':
        options.only = next().split(',').map(item => item.trim()).filter(Boolean);
        break;
      case '--list':
        options.list = true;
        break;
      case '--repeat':
        options.repeat = Math.round(positive(name, next()));
        break;
      case '--upload-mb':
        options.uploadMBs = next()
          .split(',')
          .map(item => (item === 'off' ? null : positive(name, item)));
        break;
      case '--basemap': {
        const value = next();
        if (value !== 'arcgis' && value !== 'none') {
          throw new Error(`--basemap 只能是 arcgis 或 none：${value}`);
        }
        options.basemap = value;
        break;
      }
      case '--viewport': {
        const match = /^(\d+)x(\d+)$/.exec(next());
        if (!match) {
          throw new Error('--viewport 的写法是 宽x高，如 1600x900');
        }
        options.viewport = { width: Number(match[1]), height: Number(match[2]) };
        break;
      }
      case '--pacing': {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 0) {
          throw new Error('--pacing 要是不小于 0 的整数');
        }
        options.pacing = value;
        break;
      }
      case '--antialias':
        options.antialias = true;
        break;
      case '--out':
        options.out = next();
        break;
      case '--port':
        options.port = Math.round(positive(name, next()));
        break;
      case '--load-timeout':
        options.loadTimeoutMs = positive(name, next()) * 1000;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--allow-software':
        options.allowSoftware = true;
        break;
      case '--quick':
        options.quick = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`不认识的参数：${name}（--help 看说明）`);
    }
  }
  return options;
}
