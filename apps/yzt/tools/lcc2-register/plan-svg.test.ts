// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFloorGrid } from './floor-grid.ts';
import { yawToManifestHeading } from './placement.ts';
import { type PlanInput, planProjection, type PlanRoute, planSvg, ROUTE_COLORS, routeLength } from './plan-svg.ts';
import { manifestEye, outline } from './roam-manifest.ts';
import { EYE_HEIGHT, routeOf, spawnOf, trackOf } from './roam.ts';
import { rectangle, walk } from './test-meshes.ts';

// 60 × 4 米：x 0～40 的地板在 0 米，x 40～60 高 2 米（上一层）；x 20～30 头顶 1.5 米有顶（矮通道）
const GRID = buildFloorGrid([rectangle(0, 0, 40, 4, 0), rectangle(40, 0, 60, 4, 2), rectangle(20, 0, 30, 4, 1.5)]);
// 沿 y = 2 从西往东走，扫描仪离地 1.25 米
const TRACK = trackOf(
  walk([{ from: [0, 2], to: [60, 2] }], x => (x < 40 ? 0 : 2)),
  GRID
);
const SPAWN = spawnOf(TRACK, 0);
// 第一条穿过矮通道，第二条在上一层
const ROUTES: readonly PlanRoute[] = [
  { id: 'low', name: '穿过矮通道', from: 5, to: 35, points: routeOf(TRACK, 5, 35, GRID) },
  { id: 'upper', name: '上一层', from: 45, to: 55, points: routeOf(TRACK, 45, 55, GRID) }
];
const routePoint = (x: number, y: number, floor: number) => ({ x, y, floor, eye: EYE_HEIGHT });
const INPUT: PlanInput = {
  title: '样例.lcc2',
  heading: 0,
  grid: GRID,
  track: TRACK,
  spawn: SPAWN,
  routes: ROUTES,
  walkways: [],
  gaps: []
};

const numbers = (text: string) => text.split(/[ ,]/).map(Number);
// 某个属性的值，按出现的先后
const attributes = (svg: string, name: string) =>
  [...svg.matchAll(new RegExp(` ${name}="([^"]*)"`, 'g'))].map(match => match[1]);
// 带某个标记的元素的开始标签
const tagWith = (svg: string, marker: string) => {
  const tag = new RegExp(`<[a-z]+ [^>]*${marker}[^>]*>`).exec(svg)?.[0];
  if (tag === undefined) {
    throw new Error(`图里没有 ${marker}`);
  }
  return tag;
};
const attribute = (tag: string, name: string) => {
  const value = new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];
  if (value === undefined) {
    throw new Error(`${tag} 没有 ${name}`);
  }
  return value;
};

describe('planProjection', () => {
  it('正北朝上：局部系按摆放的 heading 转过来，x 轴朝东时向右、y 轴朝北时向上', () => {
    const flat = planProjection(INPUT);
    const [x0, y0] = flat.toCanvas(10, 2);
    expect(flat.toCanvas(11, 2)).toStrictEqual([x0 + flat.scale, y0]);
    expect(flat.toCanvas(10, 3)).toStrictEqual([x0, y0 - flat.scale]);
    // 局部 x 轴朝正北（heading 90）：沿 x 走是往上
    const turned = planProjection({ ...INPUT, heading: 90 });
    const [x1, y1] = turned.toCanvas(10, 2);
    const [x2, y2] = turned.toCanvas(11, 2);
    expect(x2).toBeCloseTo(x1, 6);
    expect(y2).toBeCloseTo(y1 - turned.scale, 6);
  });

  it('方向和清单的朝向是同一个口径：画布上从正上方顺时针的角度等于 yawToManifestHeading', () => {
    for (const heading of [0, -0.102, 30, 135]) {
      const { direction } = planProjection({ ...INPUT, heading });
      for (const yaw of [0, 0.5, 2, -1.2]) {
        const [dx, dy] = direction(yaw);
        const azimuth = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        expect(azimuth).toBeCloseTo(yawToManifestHeading(yaw, heading), 6);
      }
    }
  });

  it('长边画 1500 像素，每米不超过 24 像素；轨迹超出网格时也放得下', () => {
    const { scale, width, height } = planProjection(INPUT);
    expect(scale).toBe(24);
    expect([width, height].map(Math.round)).toStrictEqual([1440, 96]);
    // 300 米长的轨迹：按长边缩到 1500 像素
    const far = planProjection({ ...INPUT, track: [{ ...TRACK[0], point: [300, 2, 1.25] }, ...TRACK] });
    expect(far.scale).toBeCloseTo(5, 6);
    expect(far.toCanvas(300, 2)[0]).toBeCloseTo(24 + 1500, 6);
  });
});

describe('planSvg', () => {
  const svg = planSvg(INPUT);
  const projection = planProjection(INPUT);

  it('每 20 米的米数和概要是同一批点：个数、米数、提示里的那一行都相同，画在轨迹的那个点上', () => {
    const lines = outline(TRACK).map(line => line.trim());
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const marks = [...svg.matchAll(/<g data-mark="(\d+)"><title>([^<]*)<\/title><circle cx="([\d.]+)" cy="([\d.]+)"/g)];
    expect(marks.map(mark => mark[2])).toStrictEqual(lines);
    expect(marks.map(mark => `${mark[1]} 米`)).toStrictEqual(lines.map(line => line.split('：')[0]));
    // 概要第二行是 20 米处，局部 (20.x, 2.0)
    const second = TRACK.find(({ distance }) => distance >= 20);
    const [x, y] = projection.toCanvas(second?.point[0] ?? NaN, second?.point[1] ?? NaN);
    expect([Number(marks[1][3]), Number(marks[1][4])]).toStrictEqual([Number(x.toFixed(1)), Number(y.toFixed(1))]);
  });

  it('地板取每格最低的一层、按高度分档：矮通道的顶不盖住地板，上一层更深；有表面的方格都画到', () => {
    const cellsAt = (step: number) => {
      const path = attribute(tagWith(svg, `data-floor="${step}"`), 'd');
      return [...path.matchAll(/h(\d+)v1/g)].reduce((sum, run) => sum + Number(run[1]), 0);
    };
    // 0.2 米的方格：x 0～40 是 200 列，x 40～60 是 100 列，20 行
    expect(cellsAt(0)).toBe(200 * 20);
    expect(cellsAt(5)).toBe(100 * 20);
    expect([1, 2, 3, 4].map(cellsAt)).toStrictEqual([0, 0, 0, 0]);
    // 同一行连着的同一档并成一个矩形：每档每行一个
    expect(attribute(tagWith(svg, 'data-floor="0"'), 'd').split('M').length - 1).toBe(20);
  });

  it('轨迹按脚下地板的高度上色：低的一层最浅、高的一层最深；矮通道那一段垫红色', () => {
    const heights = new Set(attributes(svg, 'data-height'));
    expect(heights).toStrictEqual(new Set(['0', '9']));
    const low = [...svg.matchAll(/<polyline data-low="track" points="([^"]*)"/g)].map(match => numbers(match[1]));
    expect(low).toHaveLength(1);
    // 这一段从 x = 20 到 30
    const [from] = projection.toCanvas(20, 2);
    const [to] = projection.toCanvas(30, 2);
    expect(Math.abs(low[0][0] - from)).toBeLessThan(0.3 * projection.scale);
    expect(Math.abs((low[0].at(-2) ?? NaN) - to)).toBeLessThan(0.3 * projection.scale);
  });

  it('路线按固定的先后取色，画的是生成的点；眼高低于 1.6 的点各一个圈，图例写起止、长度和点数', () => {
    expect(attributes(svg, 'data-route')).toStrictEqual(['low', 'upper']);
    expect(attributes(svg, 'data-route-line')).toStrictEqual(ROUTE_COLORS.slice(0, 2));
    const [first, second] = svg.split('<g data-route=').slice(1);
    const lowPoints = ROUTES[0].points.filter(({ eye }) => manifestEye(eye) !== undefined);
    expect(lowPoints.length).toBeGreaterThan(0);
    expect(first.split('data-low="route"').length - 1).toBe(lowPoints.length);
    expect(second.split('</g>')[0].split('data-low="route"').length - 1).toBe(0);
    expect(first).toContain(`眼高 ${lowPoints[0].eye.toFixed(2)} 米`);
    // 折线的第一个点是路线的第一个点
    const line = numbers(attribute(tagWith(first, 'data-route-line'), 'points'));
    const [x, y] = projection.toCanvas(ROUTES[0].points[0].x, ROUTES[0].points[0].y);
    expect(line.slice(0, 2)).toStrictEqual([Number(x.toFixed(1)), Number(y.toFixed(1))]);
    expect(line).toHaveLength(ROUTES[0].points.length * 2);
    expect(svg).toContain(`low 穿过矮通道：5～35 米，长 ${routeLength(ROUTES[0].points).toFixed(0)} 米`);
  });

  it('红圈和清单同一个口径：眼高取整到厘米以后低于 1.6 才画，提示里是清单写的值', () => {
    // 1.597 取整是 1.6，清单里不写眼高，图上也不画；1.594 取整是 1.59
    const points = [
      routePoint(0, 2, 0),
      { ...routePoint(5, 2, 0), eye: 1.597 },
      { ...routePoint(10, 2, 0), eye: 1.594 }
    ];
    const drawn = planSvg({ ...INPUT, routes: [{ id: 'edge', name: '边界', from: 0, to: 10, points }] });
    expect(points.map(({ eye }) => manifestEye(eye))).toStrictEqual([undefined, undefined, 1.59]);
    expect(drawn.split('data-low="route"').length - 1).toBe(1);
    expect(drawn).toContain('edge：眼高 1.59 米');
    expect(drawn).not.toContain('眼高 1.60 米');
  });

  it('补的地板按宽度画成带子，断口候选垫在轨迹的那一段下面（ADR 0170）；图例里有这两项', () => {
    const points = [routePoint(10, 2, 0), routePoint(20, 2, 0)];
    const drawn = planSvg({
      ...INPUT,
      walkways: [{ from: 10, to: 20, width: 1.2, points }],
      gaps: [{ from: 12, to: 18 }]
    });
    const band = tagWith(drawn, 'data-walkway="10-20"');
    expect(Number(attribute(band, 'stroke-width'))).toBeCloseTo(1.2 * projection.scale, 1);
    expect(numbers(attribute(band, 'points'))).toHaveLength(4);
    expect(drawn).toContain('补的地板：10～20 米，宽 1.2 米，2 个点');
    // 断口候选：轨迹上 12～18 米的取样点（每 0.25 米一个）
    const gapLine = numbers(attribute(tagWith(drawn, 'data-gap="12.0-18.0"'), 'points'));
    const inGap = TRACK.filter(({ distance }) => distance >= 12 && distance <= 18);
    expect(gapLine).toHaveLength(inGap.length * 2);
    expect(drawn).toContain('补的地板（--walkway）');
    expect(drawn).toContain('断口候选');
  });

  it('路线比颜色多时不循环：多出来的用同一种中性色', () => {
    const many = Array.from({ length: ROUTE_COLORS.length + 2 }, (_, k) => ({ ...ROUTES[1], id: `r${k}` }));
    const colors = attributes(planSvg({ ...INPUT, routes: many }), 'data-route-line');
    expect(colors.slice(0, ROUTE_COLORS.length)).toStrictEqual([...ROUTE_COLORS]);
    expect(new Set(colors.slice(ROUTE_COLORS.length)).size).toBe(1);
    expect(ROUTE_COLORS).not.toContain(colors.at(-1));
  });

  it('出生点画在出生点上，箭头朝它的朝向', () => {
    const turned = { ...INPUT, heading: 30 };
    const drawn = planSvg(turned);
    const view = planProjection(turned);
    const [x, y] = view.toCanvas(SPAWN.point.x, SPAWN.point.y);
    const point = tagWith(drawn, 'data-spawn="point"');
    expect([attribute(point, 'cx'), attribute(point, 'cy')]).toStrictEqual([x.toFixed(1), y.toFixed(1)]);
    // 沿局部 x 轴走、x 轴在正东偏北 30°：画布上的角度是 -30°（y 向下）
    const rotate = /rotate\(([-\d.]+)\)/.exec(attribute(tagWith(drawn, 'data-spawn="heading"'), 'transform'))?.[1];
    expect(Number(rotate)).toBeCloseTo(-30 - (SPAWN.yaw * 180) / Math.PI, 1);
  });

  it('比例尺取不超过 200 像素的最长一档，长度按比例；有指北针', () => {
    const bar = tagWith(svg, 'data-scale-bar');
    expect(attribute(bar, 'data-scale-bar')).toBe('5');
    expect(svg).toContain(`<path d="M0 0v6h${(5 * projection.scale).toFixed(1)}v-6"`);
    expect(svg).toContain('data-north="up"');
    expect(svg).toContain('>5 米</text>');
  });

  it('没有路线时照样画，图例里没有路线一节；标题里的特殊字符转义', () => {
    const plain = planSvg({ ...INPUT, title: 'a<b>&"c"', routes: [] });
    expect(plain).not.toContain('data-route=');
    expect(plain).not.toContain('路线（');
    expect(plain).toContain('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(plain).not.toContain('<b>');
    expect(plain.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(plain.endsWith('</svg>\n')).toBe(true);
  });
});

describe('routeLength', () => {
  it('水平的距离加地板的高差', () => {
    expect(routeLength([routePoint(0, 0, 0), routePoint(3, 4, 0), routePoint(3, 4, 2)])).toBe(7);
    expect(routeLength([routePoint(1, 1, 1)])).toBe(0);
  });
});
