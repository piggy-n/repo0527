// 命令行参数：pnpm --filter yzt lcc2:register 后面的参数原样传进来
import type { Vec3 } from './lcc2-data.ts';

export const HELP = `LCC2 的配准：算出清单里 splat 模型的 placement（ADR 0149 第 4 节，docs/config/3dt-manifest.md）

用法：pnpm --filter yzt lcc2:register <索引> [选项]

  <索引>                 .lcc2 索引的路径；相对路径从 local/3dt/ 下找（worktree 用 YZT_LOCAL_DIR 指回主目录），
                         同级要有 info/poses.json（扫描轨迹）和索引 root.meshFiles 列的碰撞网格（data/mesh/*.ply）
  --shift <东,北,上>     人工修正（米），加在拟合的结果上，移动泼溅和网格；轨迹核对算上它
  --yaw <度>             人工的偏航（度），绕局部系原点逆时针转；拟合在转过的轨迹上求平移，轨迹核对算上它
  --datum <米>           高程基准的差（米）：整体抬高，泼溅、网格、轨迹一起动，轨迹核对不算它
  --no-fit               不拟合轨迹和网格之间的平移，只用人工修正（轨迹不可信时）
  --help、-h             显示这段说明

负数直接写，如 --shift -1.2,0.5,0；PowerShell 里逗号列表要加引号，或者用空格分隔再加引号
`;

export interface Options {
  /** 索引的路径，原样保留，由调用方决定相对路径从哪里找 */
  readonly index: string;
  readonly shift: Vec3;
  readonly yaw: number;
  readonly datum: number;
  readonly fit: boolean;
  readonly help: boolean;
}

function finite(name: string, text: string): number {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) {
    throw new Error(`参数 ${name} 要是数：${text}`);
  }
  return value;
}

function vector(name: string, text: string): Vec3 {
  // 逗号或空格分隔：PowerShell 把没加引号的 1,2,3 当成数组，传进来变成 "1 2 3"
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 3) {
    throw new Error(`参数 ${name} 要写三个数（东,北,上）：${text}`);
  }
  const [east, north, up] = parts.map((part) => finite(name, part));
  return [east, north, up];
}

export function parseOptions(argv: readonly string[]): Options {
  const options: { -readonly [K in keyof Options]: Options[K] } = {
    index: '',
    shift: [0, 0, 0],
    yaw: 0,
    datum: 0,
    fit: true,
    help: false
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // pnpm 会把 -- 原样传进来
    if (arg === '--') {
      continue;
    }
    // 值可以写在等号后面，也可以是下一个参数（负数也算值，不当成选项）
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = equals > 0 ? arg.slice(0, equals) : arg;
    const value = () => {
      if (equals > 0) {
        return arg.slice(equals + 1);
      }
      if (i + 1 >= argv.length) {
        throw new Error(`参数 ${name} 缺少值`);
      }
      return argv[++i];
    };
    // 开关不带值：--no-fit=false 不能被当成"不拟合"
    const noValue = () => {
      if (equals > 0) {
        throw new Error(`参数 ${name} 不带值：${arg}`);
      }
    };
    switch (name) {
      case '--shift':
        options.shift = vector(name, value());
        break;
      case '--yaw':
        options.yaw = finite(name, value());
        break;
      case '--datum':
        options.datum = finite(name, value());
        break;
      case '--no-fit':
        noValue();
        options.fit = false;
        break;
      case '--help':
      case '-h':
        noValue();
        options.help = true;
        break;
      default:
        if (name.startsWith('--')) {
          throw new Error(`不认识的参数：${arg}`);
        }
        positional.push(arg);
    }
  }
  if (options.help) {
    return options;
  }
  if (positional.length !== 1) {
    throw new Error(`要给且只给一个 .lcc2 索引的路径，现在是 ${positional.length} 个`);
  }
  options.index = positional[0];
  return options;
}
