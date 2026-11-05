// 命令行参数；pnpm measure 后面的参数原样传进来

export const HELP = `方案 C 和 Cesium 的性能记录脚本

用法：pnpm measure [选项]

  --only <列表>          只跑部分场景，逗号分隔，按子串匹配，如 --only oblique-z19,lcc2-3m 或 --only white-z15/cesium
  --list                 列出所有场景后退出
  --repeat <n>           每个场景重复 n 次（默认 1），报告取中位数
  --basemap <arcgis|none> 底图（默认 arcgis，两个引擎相同），没网时用 none
  --viewport <宽x高>     视口（默认 1600x900）
  --dpr <n>              设备像素比（默认 1）
  --port <n>             本地服务的端口（默认 5283）
  --load-timeout <秒>    等模型稳定的上限（默认 90，LCC2 是它的 2 倍）
  --max-minutes <分>     到这个时长后不再开始新场景，写完报告退出（默认 60）
  --lcc-budgets <列表>   LCC2 的高斯预算（默认 3000000,6000000,10000000）
  --cache-mb <列表>      倾斜摄影里方案 C 另外要跑的缓存大小（默认 900），如 900,2000
  --skip-build           不重新构建，用已有的 dist
  --headless             无头模式；只有确认它走真实显卡时才用
  --allow-software       允许软件渲染跑完，结果标为无效，只用来确认脚本能跑
  --quick                缩短每段的时长，只用来确认脚本能跑
  --help                 显示这段说明
`;

function requireValue(name, value) {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`参数 ${name} 后面要写一个值`);
  }
  return value;
}

function positiveNumber(name, text) {
  const value = Number(text);
  if (!(value > 0)) {
    throw new Error(`参数 ${name} 要是正数：${text}`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    only: [],
    list: false,
    repeat: 1,
    basemap: 'arcgis',
    viewport: { width: 1600, height: 900 },
    dpr: 1,
    port: 5283,
    loadTimeoutMs: 90000,
    maxMinutes: 60,
    lccBudgets: [3000000, 6000000, 10000000],
    cacheMBs: [900],
    skipBuild: false,
    headless: false,
    allowSoftware: false,
    quick: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    const next = () => {
      i += 1;
      return requireValue(name, argv[i]);
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
        options.repeat = Math.round(positiveNumber(name, next()));
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
      case '--dpr':
        options.dpr = positiveNumber(name, next());
        break;
      case '--port':
        options.port = Math.round(positiveNumber(name, next()));
        break;
      case '--load-timeout':
        options.loadTimeoutMs = positiveNumber(name, next()) * 1000;
        break;
      case '--max-minutes':
        options.maxMinutes = positiveNumber(name, next());
        break;
      case '--lcc-budgets':
        options.lccBudgets = next().split(',').map(item => positiveNumber(name, item));
        break;
      case '--cache-mb':
        options.cacheMBs = next().split(',').map(item => positiveNumber(name, item));
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
