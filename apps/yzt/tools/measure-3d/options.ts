import type { BenchCamera } from './bench-api.ts';

// 命令行参数：pnpm --filter yzt measure:3d 后面的参数原样传进来

export const HELP = `三维（MapLibre 引擎，@mx/map-three）的性能实测、高斯泼溅的预算（ADR 0149 L.3），在显卡机器上运行

用法：pnpm --filter yzt measure:3d [选项]

  --only <列表>          只跑部分场景，逗号分隔、按子串匹配，如 --only z19 或 --only jkq2；
                         写出完整的场景 ID 时只选它，如 --only jkq-z16（不带上 jkq-z16-tilt）
                         默认只跑倾斜摄影 z17、z19；jkq、jkq2 要设环境变量 YZT_3DT_PROXY 指向服务器；
                         泼溅场景要写出 splat 才选得中，如 --only splat-pc
  --list                 列出所有场景后退出
  --at <经,纬,级别,俯角,方位>
                         选中的场景换成这个相机，如 --at 120.41234,31.51234,17.2,55,20，--only 只能选中一个场景；
                         和 --look 一起用时不限一个场景、开第一个，但要写 --only 选模型。
                         --look 窗口左上角的"相机"一行就是这个写法
  --look                 不测量：每个方案开一个窗口（第一个场景），相机同步，左上角显示读数，
                         用来找视角、肉眼看缓存上限的各档和"该清楚却糊"的地方；关掉所有窗口或按 Ctrl+C 结束。
                         跟随的窗口一帧一帧地追着走，落后约 0.2～0.5 秒；停下后在任意窗口按 R，所有窗口在这个视角
                         重新稳定再比。各档之间的数字以 --at 的测量为准
  --repeat <n>           perf 每个场景跑几遍（默认 3），报告取中位数
  --upload-mb <列表>     另外对照的上传预算，off 是不提前上传（默认 off，--look 时默认 none），如 off,16,64；
                         none 是不对照
  --cull-window <列表>   另外对照动着不请求的窗口（秒），产品默认是 auto（按实测的加载时间），
                         off 是动着也请求，如 off,1,0.5
  --cache-gb <列表>      另外对照的瓦片缓存上限（GB），到它不再加载、淘汰到它的一半，如 4,6；
                         产品默认是 2（1 GB 起淘汰），就是 MapLibre 那个方案，不用再写。每一档多跑一遍画质，
                         截图和产品默认值的比
  --release-images       产品默认值和 --cache-gb 的每一档各加一个"上传后释放贴图"的对照（只跑 perf），
                         比渲染进程和 GPU 进程的内存（ADR 0155 第 5 节）
  --splat-budget <列表>  高斯泼溅场景（--only splat）比较的总预算（高斯个数），默认 3m,6m,10m（ADR 0149 L.3）；
                         写 3m、3e6 或 3000000 都行。模型从清单里读，local/3dt/manifest.json 在时用它
                         （和开发服务器一样），见 docs/modules/map-three.md"泼溅的预算"
  --basemap <arcgis|none> 底图（默认 arcgis），没网时用 none
  --viewport <宽x高>     视口（默认 1600x900）
  --pacing <n>           在路上的帧数上限：1 是 PoC 的做法（默认 2），0 是不等
  --fps <n>              帧率封顶（默认不封顶），如 60：测量页解除了 vsync，帧比显示器多，按帧算的上传预算
                         每秒也传得多；要看用户的显示器上飞行中画得多细时用
  --antialias            打开多重采样（默认和产品一样不开），看开了以后的边缘和每帧 GPU 时用
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
  /** 选中的场景都换成这个相机；null 用场景自己的 */
  readonly at: BenchCamera | null;
  /** 不测量，开窗口看 */
  readonly look: boolean;
  readonly repeat: number;
  /** 另外对照的上传预算（MB），null 是不提前上传；没写这个参数时为 null，按 uploadBudgets 取默认 */
  readonly uploadMBs: readonly (number | null)[] | null;
  /** 另外对照的动着不请求的窗口（秒），null 是动着也请求 */
  readonly cullWindows: readonly (number | 'auto' | null)[];
  /** 另外对照的瓦片缓存上限（GB） */
  readonly cacheGBs: readonly number[];
  /** 加上"上传后释放贴图"的对照 */
  readonly releaseImages: boolean;
  /** 泼溅场景比较的总预算（高斯个数） */
  readonly splatBudgets: readonly number[];
  /** 帧率上限，null 是不封顶 */
  readonly fps: number | null;
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

// 逗号或空格分隔：PowerShell 把没加引号的 off,16 当成数组，传进来变成 "off 16"
const listItems = (text: string) => text.split(/[,\s]+/).filter(Boolean);

// 高斯个数：3m 是 300 万，也认 3e6、3000000；要是正整数
function splatCount(text: string): number {
  const millions = /^(\d+(?:\.\d+)?)m$/i.exec(text);
  // 乘完取整：4.1 * 1e6 在浮点数里是 4099999.9999999995
  const value = millions ? Math.round(Number(millions[1]) * 1e6) : Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--splat-budget 要是正整数个高斯，如 3m、3e6 或 3000000：${text}`);
  }
  return value;
}

/** 要对照的上传预算：没写 --upload-mb 时测量对照不提前上传，--look 不对照（只开要比的窗口） */
export function uploadBudgets({ uploadMBs, look }: Pick<Options, 'uploadMBs' | 'look'>): readonly (number | null)[] {
  return uploadMBs ?? (look ? [] : [null]);
}

// 经,纬,级别,俯角,方位：五个数，范围不对的直接报错，不要等页面里跳到别处
function atCamera(text: string): BenchCamera {
  const values = listItems(text).map(Number);
  const [lng = Number.NaN, lat = Number.NaN, zoom = Number.NaN, pitch = Number.NaN, bearing = Number.NaN] = values;
  const valid =
    values.length === 5 &&
    values.every(Number.isFinite) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90 &&
    zoom >= 0 &&
    zoom <= 24 &&
    pitch >= 0 &&
    pitch <= 85;
  if (!valid) {
    throw new Error(`--at 的写法是 经,纬,级别,俯角,方位，如 120.41234,31.51234,17.2,55,20（俯角 0～85）：${text}`);
  }
  return { center: [lng, lat], zoom, pitch, bearing };
}

export function parseOptions(argv: readonly string[]): Options {
  const options: { -readonly [K in keyof Options]: Options[K] } = {
    only: [],
    list: false,
    at: null,
    look: false,
    repeat: 3,
    uploadMBs: null,
    cullWindows: [],
    cacheGBs: [],
    releaseImages: false,
    splatBudgets: [3e6, 6e6, 1e7],
    fps: null,
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
        options.only = listItems(next());
        break;
      case '--list':
        options.list = true;
        break;
      case '--at':
        options.at = atCamera(next());
        break;
      case '--look':
        options.look = true;
        break;
      case '--repeat':
        options.repeat = Math.round(positive(name, next()));
        break;
      case '--upload-mb':
        options.uploadMBs = listItems(next())
          .filter(item => item !== 'none')
          .map(item => (item === 'off' ? null : positive(name, item)));
        break;
      case '--cull-window':
        options.cullWindows = listItems(next()).map(item => {
          if (item === 'off') {
            return null;
          }
          return item === 'auto' ? 'auto' : positive(name, item);
        });
        break;
      case '--cache-gb':
        options.cacheGBs = [...new Set(listItems(next()).map(item => positive(name, item)))];
        break;
      case '--release-images':
        options.releaseImages = true;
        break;
      case '--splat-budget': {
        const budgets = listItems(next());
        if (budgets.length === 0) {
          throw new Error('--splat-budget 至少写一个预算');
        }
        options.splatBudgets = [...new Set(budgets.map(splatCount))];
        break;
      }
      case '--fps':
        options.fps = positive(name, next());
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
