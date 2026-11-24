import { defineComponent, type PropType, useId, type VNode } from 'vue';
import { patternPreviewSvg } from '../fill-patterns';
import type { LegendSwatch } from '../legend';
import {
  type CircleSwatch,
  dashPixels,
  type FillSwatch,
  fittedDashPixels,
  haloWidthOf,
  type LineSwatch,
  lineWidthOf,
  outlineWidthOf,
  type Point,
  round,
  singleRadius,
  splitAlpha,
  SWATCH_SIZES,
  type SwatchSize,
  zigzag
} from '../legend-swatch-geometry';
import { shapeSvgPath } from '../point-shapes';
import styles from './LegendSwatchIcon.module.scss';

// 图例符号的画法（ADR 0159，用户 2026-11-16 确认的 A 画法）：按目标尺寸直接画，不整体缩放；
// 是按符号数据画的图形，不是图标，所以直接用 SVG，颜色是地图样式的数据

export type { SwatchSize } from '../legend-swatch-geometry';

// 线型以线宽为单位（同 MapLibre 的 line-dasharray），换成 SVG 的 stroke-dasharray
function dasharray(dash: readonly number[] | null, width: number): string | undefined {
  return dashPixels(dash, width)?.join(' ');
}

/** 折线一段上的线型，SVG 的写法；规则见 fittedDashPixels */
export function fittedDash(dash: readonly number[] | null, width: number, length: number): string | undefined {
  return fittedDashPixels(dash, width, length)?.join(' ');
}

const pointsText = (points: readonly Point[]) => points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

// 一组线：不透明时不设透明度
function renderGroup(alpha: number, children: VNode[]): VNode {
  return <g opacity={alpha < 1 ? alpha : undefined}>{children}</g>;
}

// 一段线：有线型时用平线帽画虚实，两端补上圆头；color 是不透明的颜色
function renderSegment(from: Point, to: Point, swatch: LineSwatch, color: string, height: number): VNode[] {
  const width = lineWidthOf(swatch, height);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dash = fittedDash(swatch.dash, width, length);
  const line = (
    <polyline
      points={pointsText([from, to])}
      fill="none"
      stroke={color}
      stroke-width={round(width)}
      stroke-linecap={dash ? 'butt' : 'round'}
      stroke-dasharray={dash}
      data-piece
    />
  );
  if (!dash) {
    return [line];
  }
  const cap = (at: Point) => <circle cx={round(at[0])} cy={round(at[1])} r={round(width / 2)} fill={color} />;
  return [line, cap(from), cap(to)];
}

// 一种线：实线是一条折线（圆线帽、圆拐角，同地图）；有线型时每段各自缩放线型
function renderLine(points: readonly Point[], swatch: LineSwatch, height: number): VNode {
  const [color, alpha] = splitAlpha(swatch.color);
  if (swatch.dash) {
    const segments = points.slice(1).flatMap((to, index) => {
      const from = points[index];
      return from ? renderSegment(from, to, swatch, color, height) : [];
    });
    return renderGroup(alpha, segments);
  }
  const line = (
    <polyline
      points={pointsText(points)}
      fill="none"
      stroke={color}
      stroke-width={round(lineWidthOf(swatch, height))}
      stroke-linecap="round"
      stroke-linejoin="round"
      data-piece
    />
  );
  return renderGroup(alpha, [line]);
}

// 折线的三段依次用这些线的符号，一种线时画成整条
function renderZigzag(swatches: readonly LineSwatch[], width: number, height: number): VNode[] {
  const points = zigzag(width, height);
  const [only] = swatches;
  if (swatches.length === 1 && only) {
    return [renderLine(points, only, height)];
  }
  return points.slice(1).flatMap((to, index) => {
    const from = points[index] ?? to;
    const swatch = swatches[index % swatches.length];
    return swatch ? [renderLine([from, to], swatch, height)] : [];
  });
}

// 点：最外一圈浅灰（白色描边在浅色面板上也看得出边界），再画描边、填充；描边在形状外面（同地图的 icon-halo）
function renderPoint(swatch: CircleSwatch, center: Point, radius: number, strokeWidth: number): VNode[] {
  const d = shapeSvgPath(swatch.shape, center[0], center[1], radius);
  return [
    <path class={styles.halo} d={d} stroke-width={haloWidthOf(strokeWidth)} />,
    strokeWidth > 0 && (
      <path d={d} fill={swatch.stroke} stroke={swatch.stroke} stroke-width={strokeWidth * 2} stroke-linejoin="round" />
    ),
    <path d={d} fill={swatch.fill} fill-rule="evenodd" data-piece />
  ].filter((node): node is VNode => typeof node === 'object');
}

// 几个点排成三角，两个时斜对角；半径按预览框的高度定，描边最多 1 像素
function renderCluster(swatches: readonly CircleSwatch[], width: number, height: number): VNode[] {
  const positions: readonly Point[][] = [
    [[width / 2, height / 2]],
    [
      [width * 0.32, height * 0.6],
      [width * 0.68, height * 0.4]
    ],
    [
      [width * 0.5, height * 0.33],
      [width * 0.24, height * 0.68],
      [width * 0.76, height * 0.68]
    ]
  ];
  const radius = height <= 14 ? 2.6 : height <= 16 ? 3 : 3.6;
  const at = positions[Math.min(swatches.length, 3) - 1] ?? [];
  return at.flatMap((center, index) => {
    const swatch = swatches[index];
    return swatch ? renderPoint(swatch, center, radius, Math.min(swatch.strokeWidth, 1)) : [];
  });
}

// 色块拼图的分块（单位坐标）：1～4 类，3 类时左边一大块
const BLOCKS: readonly (readonly Point[])[][] = [
  [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
  ],
  [
    [
      [0, 0],
      [0.6, 0],
      [0.4, 1],
      [0, 1]
    ],
    [
      [0.6, 0],
      [1, 0],
      [1, 1],
      [0.4, 1]
    ]
  ],
  [
    [
      [0, 0],
      [0.52, 0],
      [0.52, 1],
      [0, 1]
    ],
    [
      [0.52, 0],
      [1, 0],
      [1, 0.5],
      [0.52, 0.5]
    ],
    [
      [0.52, 0.5],
      [1, 0.5],
      [1, 1],
      [0.52, 1]
    ]
  ],
  [
    [
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5]
    ],
    [
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [0.5, 0.5]
    ],
    [
      [0, 0.5],
      [0.5, 0.5],
      [0.5, 1],
      [0, 1]
    ],
    [
      [0.5, 0.5],
      [1, 0.5],
      [1, 1],
      [0.5, 1]
    ]
  ]
];

// 花纹：同 patternPreviewSvg 的图块，平铺成背景
function renderPatternDef(id: string, swatch: FillSwatch): VNode | null {
  const preview = swatch.pattern && patternPreviewSvg(swatch.pattern.name, swatch.pattern.color);
  if (!preview) {
    return null;
  }
  const { size } = preview;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
      <image href={`data:image/svg+xml,${encodeURIComponent(preview.svg)}`} width={size} height={size} />
    </pattern>
  );
}

// 无填充的面：填充透明
const isTransparent = (color: string) => /^rgba\(.*,\s*0\)$/.test(color);

/**
 * 一个符号（ADR 0159）：面是填充、花纹加描边，线是一条三段的折线，点是带描边的形状。
 * 子图例、编辑器的选项和统一样式的摘要都用它
 */
export const LegendSwatchIcon = defineComponent({
  name: 'LegendSwatchIcon',
  props: {
    swatch: { type: Object as PropType<LegendSwatch>, required: true },
    size: { type: String as PropType<SwatchSize>, default: 'summary' }
  },
  setup(props) {
    // 同一页上有很多预览，花纹的 ID 不能重复
    const patternId = useId();

    const renderFill = (swatch: FillSwatch, width: number, height: number): (VNode | null | false)[] => {
      const outline = outlineWidthOf(swatch, height);
      // 描边画在矩形边上，往里收半个线宽才不被裁掉
      const inset = outline / 2;
      const box = { x: inset, y: inset, width: width - outline, height: height - outline, rx: 2 };
      const pattern = renderPatternDef(patternId, swatch);
      return [
        pattern && <defs>{pattern}</defs>,
        <rect {...box} fill={swatch.fill} data-piece />,
        pattern && <rect {...box} fill={`url(#${patternId})`} />,
        outline > 0 && (
          <rect
            {...box}
            fill="none"
            stroke={swatch.outline}
            stroke-width={round(outline)}
            stroke-dasharray={dasharray(swatch.outlineDash, outline)}
          />
        )
      ];
    };

    return () => {
      const { swatch } = props;
      const [width, height] = SWATCH_SIZES[props.size];
      let shapes;
      if (swatch.geometry === 'fill') {
        shapes = renderFill(swatch, width, height);
      } else if (swatch.geometry === 'line') {
        shapes = renderZigzag([swatch], width, height);
      } else {
        shapes = renderPoint(swatch, [width / 2, height / 2], singleRadius(swatch, height), swatch.strokeWidth);
      }
      return (
        <svg
          class={styles.swatch}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          data-swatch={swatch.geometry}
        >
          {shapes}
        </svg>
      );
    };
  }
});

/**
 * 按属性配色的摘要（ADR 0159）：几个代表取值按几何画，面是色块拼图，线是各段一类的折线，点是排成三角的几个点。
 * swatches 是同一几何的预览，至少一个
 */
export const LegendSummaryIcon = defineComponent({
  name: 'LegendSummaryIcon',
  props: {
    swatches: { type: Array as PropType<readonly LegendSwatch[]>, required: true },
    size: { type: String as PropType<SwatchSize>, default: 'summary' }
  },
  setup(props) {
    const id = useId();

    // 色块拼图：每块一类，块之间白线隔开，外面一圈中性的框；有花纹的块叠上花纹
    const renderMosaic = (swatches: readonly FillSwatch[], width: number, height: number) => {
      const layout = BLOCKS[Math.min(swatches.length, BLOCKS.length) - 1] ?? [];
      const clip = `${id}-clip`;
      const frame = { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 2 };
      const blocks = layout.map((points, index) => {
        const swatch = swatches[index % swatches.length];
        if (!swatch) {
          return null;
        }
        const d = `M${points.map(([x, y]) => `${round(x * width)} ${round(y * height)}`).join('L')}Z`;
        const pattern = renderPatternDef(`${id}-${index}`, swatch);
        // 无填充的类别用描边色（同改版前的规则），不留一块空白
        const color = isTransparent(swatch.fill) ? swatch.outline : swatch.fill;
        return [
          pattern && <defs>{pattern}</defs>,
          <path d={d} fill={color} data-piece />,
          pattern && <path d={d} fill={`url(#${id}-${index})`} />,
          <path class={styles.separator} d={d} />
        ];
      });
      return [
        <defs>
          <clipPath id={clip}>
            <rect {...frame} />
          </clipPath>
        </defs>,
        <g clip-path={`url(#${clip})`}>{blocks}</g>,
        <rect class={styles.frame} {...frame} />
      ];
    };

    return () => {
      const [width, height] = SWATCH_SIZES[props.size];
      const [first] = props.swatches;
      let shapes;
      if (first?.geometry === 'fill') {
        const fills = props.swatches.filter((swatch): swatch is FillSwatch => swatch.geometry === 'fill');
        shapes = renderMosaic(fills, width, height);
      } else if (first?.geometry === 'line') {
        const lines = props.swatches.filter((swatch): swatch is LineSwatch => swatch.geometry === 'line');
        shapes = renderZigzag(lines, width, height);
      } else {
        const points = props.swatches.filter((swatch): swatch is CircleSwatch => swatch.geometry === 'circle');
        shapes = renderCluster(points, width, height);
      }
      return (
        <svg
          class={styles.swatch}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          data-summary={first?.geometry}
        >
          {shapes}
        </svg>
      );
    };
  }
});
