// 轨迹的平面图（lcc2:register --plan，ADR 0156 第 4 节）：挑路线段、核对出生点和路线用。画碰撞网格的地板、修正后的扫描轨迹、
// 每 20 米的米数（同概要）、出生点、路线；正北朝上，和 /dev/nav-grid 的平面图同一个方向。这里只算和拼字符串，写文件在 cli.ts
import type { FloorGrid } from './floor-grid.ts';
import { outlineLine, outlineSamples } from './roam-manifest.ts';
import { EYE_HEIGHT, eyeAbove, HEAD_CLEARANCE, type RoamPoint, type TrackSample } from './roam.ts';

/** 画在图上的一条路线：轨迹上的起止米数，和生成的路线（局部系，就是写进清单的那些点） */
export interface PlanRoute {
  readonly id: string;
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly points: readonly RoamPoint[];
}

export interface PlanInput {
  readonly title: string;
  /** 局部 x 轴从正东逆时针转的角度（度），同清单的 placement.heading */
  readonly heading: number;
  readonly grid: FloorGrid;
  /** 修正后的轨迹（网格的局部系），同概要 */
  readonly track: readonly TrackSample[];
  /** 出生点（局部系）和朝向（从局部 x 轴逆时针的弧度） */
  readonly spawn: { readonly point: RoamPoint; readonly yaw: number };
  readonly routes: readonly PlanRoute[];
}

/** 局部系到画布的换算：正北朝上 */
export interface PlanProjection {
  /** 每米多少像素 */
  readonly scale: number;
  /** 地图部分的宽高（像素），不含边距和图例 */
  readonly width: number;
  readonly height: number;
  readonly toCanvas: (x: number, y: number) => readonly [number, number];
  /** 局部系里的方向（从 x 轴逆时针的弧度）在画布上的单位向量 */
  readonly direction: (yaw: number) => readonly [number, number];
}

const DEGREE = Math.PI / 180;
const MARGIN = 24;
const PANEL_WIDTH = 400;
// 地图的长边画这么多像素，每米的像素数限在这个范围里
const MAP_SIDE = 1500;
const MIN_SCALE = 3;
const MAX_SCALE = 24;
/** 每隔这么多米标一个米数，同概要 */
export const MARK_STEP = 20;

// 配色：底色、文字是中性色；高度由浅到深，轨迹用蓝、地板用灰，同一个刻度；路线按固定的先后取色，不循环（超出的用次要文字色）；
// 矮的地方用红色，另有形状和图例，不只靠颜色
const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const INK_SECONDARY = '#52514e';
const NO_FLOOR = '#8a8985';
const LOW = '#d03b3b';
export const HEIGHT_RAMP: readonly string[] = [
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b'
];
export const FLOOR_RAMP: readonly string[] = ['#efeeea', '#e3e2dd', '#d7d6d0', '#cbcac4', '#bfbeb7', '#b2b1aa'];
export const ROUTE_COLORS: readonly string[] = [
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948'
];
/** 比例尺取这些长度（米）里画出来不超过 200 像素的最长一个 */
const SCALE_BARS = [100, 50, 20, 10, 5, 2, 1];

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const px = (value: number) => value.toFixed(1);
const meters = (value: number) => value.toFixed(2);

export function planProjection({
  heading,
  grid,
  track
}: Pick<PlanInput, 'heading' | 'grid' | 'track'>): PlanProjection {
  const cos = Math.cos(heading * DEGREE);
  const sin = Math.sin(heading * DEGREE);
  const east = (x: number, y: number) => x * cos - y * sin;
  const north = (x: number, y: number) => x * sin + y * cos;
  const maxX = grid.minX + grid.columns * grid.cellSize;
  const maxY = grid.minY + grid.rows * grid.cellSize;
  const corners: (readonly [number, number])[] =
    grid.columns > 0
      ? [
          [grid.minX, grid.minY],
          [maxX, grid.minY],
          [maxX, maxY],
          [grid.minX, maxY]
        ]
      : [];
  let eastMin = Infinity;
  let eastMax = -Infinity;
  let northMin = Infinity;
  let northMax = -Infinity;
  for (const [x, y] of [...corners, ...track.map(({ point }) => [point[0], point[1]] as const)]) {
    eastMin = Math.min(eastMin, east(x, y));
    eastMax = Math.max(eastMax, east(x, y));
    northMin = Math.min(northMin, north(x, y));
    northMax = Math.max(northMax, north(x, y));
  }
  if (eastMin === Infinity) {
    eastMin = eastMax = northMin = northMax = 0;
  }
  // 至少画 1 米见方
  const spanEast = Math.max(1, eastMax - eastMin);
  const spanNorth = Math.max(1, northMax - northMin);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, MAP_SIDE / Math.max(spanEast, spanNorth)));
  return {
    scale,
    width: spanEast * scale,
    height: spanNorth * scale,
    toCanvas: (x, y) => [MARGIN + (east(x, y) - eastMin) * scale, MARGIN + (northMax - north(x, y)) * scale],
    direction: yaw => [Math.cos(yaw + heading * DEGREE), -Math.sin(yaw + heading * DEGREE)]
  };
}

// 连着的、键相同的一段：[first, last] 是序号
function runsOf<T>(items: readonly T[], keyOf: (item: T) => number): { key: number; first: number; last: number }[] {
  const runs: { key: number; first: number; last: number }[] = [];
  items.forEach((item, index) => {
    const key = keyOf(item);
    const current = runs.at(-1);
    if (current?.key === key) {
      current.last = index;
    } else {
      runs.push({ key, first: index, last: index });
    }
  });
  return runs;
}

/** 高度的刻度：轨迹脚下地板的最低、最高；几乎是平的、轨迹脚下都没有网格时都落在中间一档 */
interface HeightScale {
  readonly low: number;
  readonly high: number;
  /** 高度在 steps 档里是第几档，刻度以外的夹到两头 */
  readonly stepOf: (height: number, steps: number) => number;
}

function heightScale(track: readonly TrackSample[]): HeightScale {
  let low = Infinity;
  let high = -Infinity;
  for (const { floor } of track) {
    if (floor !== undefined) {
      low = Math.min(low, floor);
      high = Math.max(high, floor);
    }
  }
  const span = high - low;
  return {
    low,
    high,
    stepOf: (height, steps) =>
      span >= 0.05
        ? Math.min(steps - 1, Math.max(0, Math.floor(((height - low) / span) * steps)))
        : Math.floor(steps / 2)
  };
}

// 地板：每个方格取最低的一层表面（屋顶、顶板下面的那一层），按高度分成几档灰，同一行连着的同一档并成一个矩形；
// 坐标是方格的行列，由变换放到画布上
function floorPaths(
  grid: FloorGrid,
  { scale, toCanvas }: PlanProjection,
  heading: number,
  heights: HeightScale
): string {
  const steps = FLOOR_RAMP.length;
  const paths = FLOOR_RAMP.map((): string[] => []);
  for (let row = 0; row < grid.rows; row++) {
    const cells = Array.from({ length: grid.columns }, (_, column) => {
      const cell = row * grid.columns + column;
      const first = grid.offsets[cell];
      return first === grid.offsets[cell + 1] ? -1 : heights.stepOf(grid.heights[first], steps);
    });
    for (const { key, first, last } of runsOf(cells, step => step)) {
      if (key >= 0) {
        const length = last - first + 1;
        paths[key].push(`M${first} ${row}h${length}v1h-${length}z`);
      }
    }
  }
  const size = grid.cellSize * scale;
  const cos = Math.cos(heading * DEGREE) * size;
  const sin = Math.sin(heading * DEGREE) * size;
  const [originX, originY] = toCanvas(grid.minX, grid.minY);
  const matrix = [cos, -sin, -sin, -cos, originX, originY].map(value => value.toFixed(4)).join(' ');
  const filled = paths.map(
    (runs, step) => `<path data-floor="${step}" fill="${FLOOR_RAMP[step]}" d="${runs.join('')}"/>`
  );
  return `<g data-layer="floor" transform="matrix(${matrix})" shape-rendering="crispEdges">${filled.join('')}</g>`;
}

// 这个取样点矮不矮：按净空算出的眼高不到 EYE_HEIGHT
const isLow = ({ floor, ceiling }: TrackSample) => floor !== undefined && eyeAbove(floor, ceiling) < EYE_HEIGHT;

function trackLayers(track: readonly TrackSample[], { toCanvas }: PlanProjection, heights: HeightScale): string {
  const at = (index: number) => {
    const [x, y] = toCanvas(track[index].point[0], track[index].point[1]);
    return `${px(x)},${px(y)}`;
  };
  // 只有一个点的也画成两个点，线帽是圆的，看得到
  const line = (first: number, last: number) =>
    Array.from({ length: Math.max(2, last - first + 1) }, (_, k) => at(Math.min(last, first + k))).join(' ');
  // 矮的地方：垫在轨迹下面的一道红色
  const low = runsOf(track, sample => (isLow(sample) ? 1 : 0))
    .filter(({ key }) => key === 1)
    .map(({ first, last }) => `<polyline data-low="track" points="${line(first, last)}"/>`);
  // 按脚下地板的高度分档上色，脚下没有网格的是 -1；每段多画到下一段的第一个点，接得上
  const stepOf = ({ floor }: TrackSample) => (floor === undefined ? -1 : heights.stepOf(floor, HEIGHT_RAMP.length));
  const pieces = runsOf(track, stepOf).map(({ key, first, last }) => ({
    key,
    points: line(first, Math.min(track.length - 1, last + 1))
  }));
  const casing = pieces.map(({ points }) => `<polyline points="${points}"/>`);
  const colored = pieces.map(({ key, points }) =>
    key === -1
      ? `<polyline data-height="none" stroke="${NO_FLOOR}" stroke-dasharray="4 3" points="${points}"/>`
      : `<polyline data-height="${key}" stroke="${HEIGHT_RAMP[key]}" points="${points}"/>`
  );
  return (
    `<g data-layer="low" fill="none" stroke="${LOW}" stroke-opacity="0.4" stroke-width="9" ` +
    `stroke-linecap="round" stroke-linejoin="round">${low.join('')}</g>` +
    `<g fill="none" stroke="${SURFACE}" stroke-width="4" stroke-linejoin="round">${casing.join('')}</g>` +
    `<g data-layer="track" fill="none" stroke-width="2" stroke-linejoin="round">${colored.join('')}</g>`
  );
}

const routeColor = (index: number) => ROUTE_COLORS[index] ?? INK_SECONDARY;

/** 路线的长度（米）：水平加地板的高差 */
export function routeLength(points: readonly RoamPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot(b.x - a.x, b.y - a.y, b.floor - a.floor);
  }
  return length;
}

const routeSummary = ({ id, name, from, to, points }: PlanRoute) =>
  `${id} ${name}：${from}～${to} 米，长 ${routeLength(points).toFixed(0)} 米，${points.length} 个点`;

// 带底色描边的文字：压在线上也看得清
const label = (x: number, y: number, text: string, extra = '') =>
  `<text x="${px(x)}" y="${px(y)}" stroke="${SURFACE}" stroke-width="3" paint-order="stroke" ${extra}>` +
  `${escape(text)}</text>`;

function routeLayers(routes: readonly PlanRoute[], { toCanvas }: PlanProjection): string {
  const parts = routes.map((route, index) => {
    const color = routeColor(index);
    const canvas = route.points.map(({ x, y }) => toCanvas(x, y));
    const points = canvas.map(([x, y]) => `${px(x)},${px(y)}`).join(' ');
    const [startX, startY] = canvas[0];
    const [endX, endY] = canvas.at(-1) ?? canvas[0];
    const [beforeX, beforeY] = canvas.at(-2) ?? canvas[0];
    // 终点的箭头，朝最后一段的方向
    const angle = (Math.atan2(endY - beforeY, endX - beforeX) / DEGREE).toFixed(1);
    const lows = route.points
      .map((point, k) => ({ point, spot: canvas[k] }))
      .filter(({ point }) => point.eye < EYE_HEIGHT)
      .map(
        ({ point, spot: [x, y] }) =>
          `<circle data-low="route" cx="${px(x)}" cy="${px(y)}" r="4" fill="${SURFACE}" stroke="${LOW}" ` +
          `stroke-width="2">` +
          `<title>${escape(route.id)}：眼高 ${meters(point.eye)} 米</title></circle>`
      );
    return (
      `<g data-route="${escape(route.id)}"><title>${escape(routeSummary(route))}</title>` +
      `<polyline fill="none" stroke="${SURFACE}" stroke-width="7" stroke-linejoin="round" points="${points}"/>` +
      `<polyline data-route-line="${color}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round" ` +
      `points="${points}"/>` +
      `<path d="M0 0l-11 -5v10z" fill="${color}" stroke="${SURFACE}" ` +
      `transform="translate(${px(endX)} ${px(endY)}) rotate(${angle})"/>` +
      `<circle cx="${px(startX)}" cy="${px(startY)}" r="5.5" fill="${color}" stroke="${SURFACE}" stroke-width="2"/>` +
      lows.join('') +
      label(startX + 9, startY + 15, route.id, 'font-weight="600"') +
      '</g>'
    );
  });
  return `<g data-layer="routes">${parts.join('')}</g>`;
}

// 每 20 米的米数：和概要是同一批取样点；标注放在行进方向的一侧，来回走过同一处时两个标注分在两边
function markLayer(track: readonly TrackSample[], { toCanvas }: PlanProjection): string {
  const marks = outlineSamples(track, MARK_STEP).map(sample => {
    const index = track.indexOf(sample);
    const [x, y] = toCanvas(sample.point[0], sample.point[1]);
    const before = track[Math.max(0, index - 2)].point;
    const after = track[Math.min(track.length - 1, index + 2)].point;
    const [x0, y0] = toCanvas(before[0], before[1]);
    const [x1, y1] = toCanvas(after[0], after[1]);
    const length = Math.hypot(x1 - x0, y1 - y0);
    // 行进方向左手边的单位向量；原地不动时放在右上
    const [sideX, sideY] = length > 0 ? [(y1 - y0) / length, -(x1 - x0) / length] : [0.7, -0.7];
    const anchor = sideX < -0.3 ? 'end' : sideX > 0.3 ? 'start' : 'middle';
    const meter = sample.distance.toFixed(0);
    return (
      `<g data-mark="${meter}"><title>${escape(outlineLine(sample).trim())}</title>` +
      `<circle cx="${px(x)}" cy="${px(y)}" r="3" fill="${INK}" stroke="${SURFACE}" stroke-width="1.5"/>` +
      // 看不见的大一圈：鼠标容易停上去看提示
      `<circle cx="${px(x)}" cy="${px(y)}" r="9" fill="${SURFACE}" fill-opacity="0"/>` +
      label(x + sideX * 9, y + sideY * 9 + 4, meter, `text-anchor="${anchor}"`) +
      '</g>'
    );
  });
  return `<g data-layer="marks" font-size="11">${marks.join('')}</g>`;
}

function spawnLayer({ point, yaw }: PlanInput['spawn'], { toCanvas, direction }: PlanProjection): string {
  const [x, y] = toCanvas(point.x, point.y);
  const [dx, dy] = direction(yaw);
  const angle = (Math.atan2(dy, dx) / DEGREE).toFixed(1);
  const place = `translate(${px(x)} ${px(y)})`;
  return (
    `<g data-layer="spawn"><title>出生点：局部 (${point.x.toFixed(1)}, ${point.y.toFixed(1)})，` +
    `地板 ${meters(point.floor)}</title>` +
    `<path data-spawn="heading" d="M0 0h24m0 0l-8 -5v10z" fill="${INK}" stroke="${INK}" stroke-width="2.5" ` +
    `transform="${place} rotate(${angle})"/>` +
    `<circle data-spawn="point" cx="${px(x)}" cy="${px(y)}" r="6.5" fill="${SURFACE}" stroke="${INK}" ` +
    `stroke-width="2.5"/>` +
    label(x + 10, y - 10, '出生点', 'font-weight="600"') +
    '</g>'
  );
}

// 右边的图例：标题、比例尺和指北针、高度的色带、各种标记、路线
function panel(input: PlanInput, { scale }: PlanProjection, heights: HeightScale, left: number) {
  const { title, heading, track, routes } = input;
  const rows: string[] = [];
  let y = MARGIN + 14;
  const text = (content: string, extra = '') => {
    rows.push(`<text x="${left}" y="${y}" ${extra}>${escape(content)}</text>`);
    y += 20;
  };
  // 一行图例：左边 40 像素宽的图样，右边文字
  const item = (sample: string, content: string) => {
    rows.push(`<g transform="translate(${left} ${y - 4})">${sample}</g>`);
    rows.push(`<text x="${left + 50}" y="${y}">${escape(content)}</text>`);
    y += 22;
  };
  const muted = `fill="${INK_SECONDARY}"`;
  text(title, 'font-size="15" font-weight="600"');
  text(`轨迹共 ${(track.at(-1)?.distance ?? 0).toFixed(0)} 米，每 ${MARK_STEP} 米标一个米数，同概要`, muted);
  text(`正北朝上；局部 x 轴从正东逆时针转 ${heading.toFixed(3)}°`, muted);
  y += 6;

  const bar = SCALE_BARS.find(length => length * scale <= 200) ?? 1;
  rows.push(
    `<g data-scale-bar="${bar}" transform="translate(${left} ${y})">` +
      `<path d="M0 0v6h${px(bar * scale)}v-6" fill="none" stroke="${INK}" stroke-width="1.5"/>` +
      `<text x="${px(bar * scale + 8)}" y="7">${bar} 米</text></g>`
  );
  rows.push(
    `<g data-north="up" transform="translate(${left + 340} ${y + 6})">` +
      `<path d="M0 -16l7 20l-7 -5l-7 5z" fill="${INK}"/><text y="20" text-anchor="middle">北</text></g>`
  );
  y += 44;

  text('高度（局部系的 z，不是椭球高）：越深越高', 'font-weight="600"');
  const ramp = (colors: readonly string[], name: string) => {
    const width = 200 / colors.length;
    const swatches = colors.map((color, k) => `<rect x="${k * width}" width="${width}" height="10" fill="${color}"/>`);
    rows.push(`<g data-ramp="${name}" transform="translate(${left} ${y - 10})">${swatches.join('')}</g>`);
  };
  ramp(HEIGHT_RAMP, 'track');
  rows.push(`<text x="${left + 210}" y="${y}">轨迹：脚下的地板</text>`);
  y += 14;
  ramp(FLOOR_RAMP, 'floor');
  rows.push(`<text x="${left + 210}" y="${y}">地板：每格最低的表面</text>`);
  y += 16;
  rows.push(
    Number.isFinite(heights.low)
      ? `<text x="${left}" y="${y}" ${muted}>${meters(heights.low)} 米</text>` +
          `<text x="${left + 200}" y="${y}" text-anchor="end" ${muted}>${meters(heights.high)} 米</text>`
      : `<text x="${left}" y="${y}" ${muted}>轨迹脚下都没有网格</text>`
  );
  y += 30;

  text('标记', 'font-weight="600"');
  item(`<circle cx="20" r="3" fill="${INK}"/>`, '轨迹上的米数');
  item(
    `<circle cx="12" r="6.5" fill="${SURFACE}" stroke="${INK}" stroke-width="2.5"/>` +
      `<path d="M19 0h15m0 0l-7 -4v8z" stroke="${INK}" stroke-width="2"/>`,
    '出生点和朝向'
  );
  item(
    `<path d="M5 0h30" stroke="${LOW}" stroke-opacity="0.4" stroke-width="9" stroke-linecap="round"/>`,
    `净空不到 ${(EYE_HEIGHT + HEAD_CLEARANCE).toFixed(1)} 米的轨迹：眼高低于 ${EYE_HEIGHT}`
  );
  item(
    `<circle cx="20" r="4" fill="${SURFACE}" stroke="${LOW}" stroke-width="2"/>`,
    `路线上眼高低于 ${EYE_HEIGHT} 的点`
  );
  item(`<path d="M0 0h40" stroke="${NO_FLOOR}" stroke-width="2" stroke-dasharray="4 3"/>`, '脚下没有网格的轨迹');

  if (routes.length > 0) {
    y += 8;
    text('路线（轨迹上的起止、长度、点数）', 'font-weight="600"');
    routes.forEach((route, index) => {
      item(`<path d="M0 0h40" stroke="${routeColor(index)}" stroke-width="3.5"/>`, routeSummary(route));
    });
  }
  return { svg: `<g data-layer="legend">${rows.join('')}</g>`, height: y };
}

/** 平面图的 SVG：一个文件，不引用外部资源 */
export function planSvg(input: PlanInput): string {
  const projection = planProjection(input);
  const heights = heightScale(input.track);
  const left = MARGIN * 2 + Math.ceil(projection.width);
  const legend = panel(input, projection, heights, left);
  const width = left + PANEL_WIDTH + MARGIN;
  const height = Math.ceil(Math.max(projection.height + MARGIN * 2, legend.height + MARGIN));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `role="img" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="12" fill="${INK}">` +
    `<title>${escape(input.title)} 的轨迹平面图</title>` +
    `<rect width="${width}" height="${height}" fill="${SURFACE}"/>` +
    floorPaths(input.grid, projection, input.heading, heights) +
    trackLayers(input.track, projection, heights) +
    routeLayers(input.routes, projection) +
    markLayer(input.track, projection) +
    spawnLayer(input.spawn, projection) +
    legend.svg +
    '</svg>\n'
  );
}
