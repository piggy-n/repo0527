// 命令行参数：pnpm --filter yzt lcc2:register 后面的参数原样传进来
import type { Vec3 } from './lcc2-data.ts';
import { ToolError } from './errors.ts';
import type { Stretch } from './roam.ts';

export const HELP = `LCC2 的配准：算出清单里 splat 模型的 placement（ADR 0149 第 4 节，docs/config/3dt-manifest.md）

用法：pnpm --filter yzt lcc2:register <索引> --datum <米> [选项]

  <索引>                 .lcc2 索引的路径或完整的 http(s) 地址；相对路径从 local/3dt/ 下找（worktree 用 YZT_LOCAL_DIR 指回主目录），
                         设了环境变量 YZT_3DT_PROXY 时从 <它>/3dt/ 读，中文照写，工具会编码；
                         同级要有 info/poses.json（扫描轨迹）和索引 root.meshFiles 列的碰撞网格（data/mesh/*.ply）
  --shift <东,北,上>     人工修正（米），加在拟合的结果上，移动泼溅和网格；轨迹核对算上它
  --yaw <度>             人工的偏航（度），绕局部系原点逆时针转；拟合在转过的轨迹上求平移，轨迹核对算上它
  --datum <米>           必填。高程基准的差（米）：整体抬高，泼溅、网格、轨迹一起动，轨迹核对不算它；
                         徐州的数据写 5.47，别处的数据没有量出差值时写 0（docs/config/3dt-manifest.md）
  --no-fit               不拟合轨迹和网格之间的平移，只用人工修正（轨迹不可信时）
  --roam                 再给出步行的出生点（清单的 spawn），并每 20 米列一行轨迹的概要，用来挑路线段（ADR 0156 第 4 节）
  --spawn-at <米>        出生点从轨迹的这个米数往后找（扫描不是从入口开始时），带上它就是 --roam
  --route <ID:名称:起-止[:容差]>
                         轨迹上起～止米这一段做成一条路线（清单的 routes），可以写多次、ID 不能重复，带上它就是 --roam；
                         容差是拉直的水平容差（米，默认 1）：扫描的人在宽的坡道、走廊里左右摆得大时调大
  --straight <起-止:容差>  轨迹上起～止米这一段拉直的水平容差（米），比 --route 写的优先，可以写多次：
                         一条路线里只有宽的坡道、走廊一段要调大时用，进小室又出来这类地方留默认值
  --diagnose             再逐个列出拉直以后留下的拐点和原因（每条路线的计数总会打印），带上它就是 --roam
  --plan <文件.svg>      再画一张平面图：地板、轨迹和每 20 米的米数（同概要）、出生点、路线，挑路线段和核对用；
                         相对路径放在 local/ 下（如 lcc2-plan/xz-gshm.svg），带上它就是 --roam
  --help、-h             显示这段说明

负数直接写，如 --shift -1.2,0.5,0；PowerShell 里逗号列表要加引号，或者用空格分隔再加引号
`;

export interface Options {
  /** 索引的路径，原样保留，由调用方决定相对路径从哪里找 */
  readonly index: string;
  readonly shift: Vec3;
  readonly yaw: number;
  /** 高程基准的差：必填，没有默认值（漏写时按 0 算，模型会悄悄低几米） */
  readonly datum: number;
  readonly fit: boolean;
  /** 给出出生点、轨迹概要和路线 */
  readonly roam: boolean;
  readonly spawnAt: number;
  readonly routes: readonly RouteSpan[];
  /** 按轨迹米数分段的拉直容差 */
  readonly stretches: readonly Stretch[];
  /** 逐个列出拉直以后留下的拐点和原因 */
  readonly diagnose: boolean;
  /** 平面图写到哪个文件，原样保留，由调用方决定相对路径放在哪；不画时为 null */
  readonly plan: string | null;
  readonly help: boolean;
}

/** 轨迹上做成路线的一段：清单里的 ID、名称，轨迹上的起止米数，拉直的水平容差（米，没写时用默认值） */
export interface RouteSpan {
  readonly id: string;
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly tolerance?: number;
}

function finite(name: string, text: string): number {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) {
    throw new ToolError(`参数 ${name} 要是数：${text}`);
  }
  return value;
}

function vector(name: string, text: string): Vec3 {
  // 逗号或空格分隔：PowerShell 把没加引号的 1,2,3 当成数组，传进来变成 "1 2 3"
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 3) {
    throw new ToolError(`参数 ${name} 要写三个数（东,北,上）：${text}`);
  }
  const [east, north, up] = parts.map((part) => finite(name, part));
  return [east, north, up];
}

function routeSpan(name: string, text: string): RouteSpan {
  const match = /^([\w-]+):([^:]+):([\d.]+)-([\d.]+)(?::([\d.]+))?$/u.exec(text.trim());
  if (!match) {
    throw new ToolError(
      `参数 ${name} 要写成 ID:名称:起-止（米），可以再加 :容差（米），如 tomb:进墓室:120-380 或 hall:进厅:25-75:3：${text}`
    );
  }
  const [, id, title, from, to, tolerance] = match;
  const span = { id, name: title, from: finite(name, from), to: finite(name, to) };
  if (tolerance === undefined) {
    return span;
  }
  const value = finite(name, tolerance);
  if (!(value > 0)) {
    throw new ToolError(`参数 ${name} 的容差要大于 0：${text}`);
  }
  return { ...span, tolerance: value };
}

function stretch(name: string, text: string): Stretch {
  const match = /^([\d.]+)-([\d.]+):([\d.]+)$/u.exec(text.trim());
  if (!match) {
    throw new ToolError(`参数 ${name} 要写成 起-止:容差（米），如 545-600:3：${text}`);
  }
  const [from, to, tolerance] = match.slice(1).map(part => finite(name, part));
  if (!(to > from) || !(tolerance > 0)) {
    throw new ToolError(`参数 ${name} 的止要大于起、容差要大于 0：${text}`);
  }
  return { from, to, tolerance };
}

function planFile(name: string, text: string): string {
  // 忘了写值时下一个参数会被当成文件名；只认 .svg，也免得写到别的文件上
  if (!/\.svg$/i.test(text)) {
    throw new ToolError(`参数 ${name} 要写一个 .svg 文件：${text}`);
  }
  return text;
}

export function parseOptions(argv: readonly string[]): Options {
  const options: { -readonly [K in keyof Options]: Options[K] } = {
    index: '',
    shift: [0, 0, 0],
    yaw: 0,
    datum: 0,
    fit: true,
    roam: false,
    spawnAt: 0,
    routes: [],
    stretches: [],
    diagnose: false,
    plan: null,
    help: false
  };
  const positional: string[] = [];
  let datumGiven = false;
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
        throw new ToolError(`参数 ${name} 缺少值`);
      }
      return argv[++i];
    };
    // 开关不带值：--no-fit=false 不能被当成"不拟合"
    const noValue = () => {
      if (equals > 0) {
        throw new ToolError(`参数 ${name} 不带值：${arg}`);
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
        datumGiven = true;
        break;
      case '--roam':
        noValue();
        options.roam = true;
        break;
      case '--spawn-at':
        options.spawnAt = finite(name, value());
        options.roam = true;
        break;
      case '--route': {
        const route = routeSpan(name, value());
        if (options.routes.some(({ id }) => id === route.id)) {
          throw new ToolError(`参数 ${name} 的 ID 重复：${route.id}（同一模型的路线 ID 不能重复）`);
        }
        options.routes = [...options.routes, route];
        options.roam = true;
        break;
      }
      case '--straight':
        options.stretches = [...options.stretches, stretch(name, value())];
        options.roam = true;
        break;
      case '--diagnose':
        noValue();
        options.diagnose = true;
        options.roam = true;
        break;
      case '--plan':
        options.plan = planFile(name, value());
        options.roam = true;
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
          throw new ToolError(`不认识的参数：${arg}`);
        }
        positional.push(arg);
    }
  }
  if (options.help) {
    return options;
  }
  if (positional.length !== 1) {
    throw new ToolError(`要给且只给一个 .lcc2 索引的路径，现在是 ${positional.length} 个`);
  }
  options.index = positional[0];
  // 没有默认值：徐州的数据漏写时按 0 算，高度会悄悄低 5.47 米
  if (!datumGiven) {
    throw new ToolError('要写 --datum <米>（高程基准的差）：徐州的数据写 5.47，别处的数据没有量出差值时写 --datum 0');
  }
  return options;
}
