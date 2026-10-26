import { defineComponent, type PropType, useId } from 'vue';
import { patternPreviewSvg } from '../fill-patterns';
import type { LegendSwatch } from '../legend';
import styles from './LegendSwatchIcon.module.scss';

// 预览框（设计稿 5D.5）；宽度和半径由 swatchOf 按上限给出，这里只负责画
const WIDTH = 28;
const HEIGHT = 20;

// 线型以线宽为单位（同 MapLibre 的 line-dasharray），换成 SVG 的像素
function dasharray(dash: readonly number[] | null, width: number): string | undefined {
  return dash?.map(value => Number((value * width).toFixed(2))).join(' ');
}

const renderLine = (swatch: Extract<LegendSwatch, { geometry: 'line' }>) => (
  <line
    x1={1}
    y1={HEIGHT / 2}
    x2={WIDTH - 1}
    y2={HEIGHT / 2}
    stroke={swatch.color}
    stroke-width={swatch.width}
    stroke-dasharray={dasharray(swatch.dash, swatch.width)}
  />
);

// 描边画在半径外面（同 MapLibre）；白色描边在浅色面板上看不清，最外面再描一圈浅灰
function renderCircle(swatch: Extract<LegendSwatch, { geometry: 'circle' }>) {
  const outer = swatch.radius + swatch.strokeWidth;
  return [
    <circle class={styles.halo} cx={WIDTH / 2} cy={HEIGHT / 2} r={outer + 0.5} />,
    swatch.strokeWidth > 0 && <circle cx={WIDTH / 2} cy={HEIGHT / 2} r={outer} fill={swatch.stroke} />,
    <circle cx={WIDTH / 2} cy={HEIGHT / 2} r={swatch.radius} fill={swatch.fill} />
  ];
}

/**
 * 图例里的符号预览（ADR 0043、0044，设计稿 5D.5）：面是填充、花纹加描边，线是一段线，点是带描边的圆点。
 * 是按符号数据画的图形，不是图标，所以直接用 SVG；颜色是地图样式的数据
 */
export const LegendSwatchIcon = defineComponent({
  name: 'LegendSwatchIcon',
  props: {
    swatch: { type: Object as PropType<LegendSwatch>, required: true }
  },
  setup(props) {
    // 同一页上有很多预览，花纹的 ID 不能重复
    const patternId = useId();

    const renderFill = (swatch: Extract<LegendSwatch, { geometry: 'fill' }>) => {
      const { outlineWidth } = swatch;
      // 描边画在矩形边上，往里收半个线宽才不被裁掉
      const inset = outlineWidth / 2;
      const box = { x: inset, y: inset, width: WIDTH - outlineWidth, height: HEIGHT - outlineWidth, rx: 1.5 };
      const preview = swatch.pattern && patternPreviewSvg(swatch.pattern.name, swatch.pattern.color);
      return [
        preview && (
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width={preview.size} height={preview.size}>
              <image
                href={`data:image/svg+xml,${encodeURIComponent(preview.svg)}`}
                width={preview.size}
                height={preview.size}
              />
            </pattern>
          </defs>
        ),
        <rect {...box} fill={swatch.fill} />,
        preview && <rect {...box} fill={`url(#${patternId})`} />,
        outlineWidth > 0 && (
          <rect
            {...box}
            fill="none"
            stroke={swatch.outline}
            stroke-width={outlineWidth}
            stroke-dasharray={dasharray(swatch.outlineDash, outlineWidth)}
          />
        )
      ];
    };

    return () => {
      const { swatch } = props;
      let shapes;
      if (swatch.geometry === 'fill') {
        shapes = renderFill(swatch);
      } else if (swatch.geometry === 'line') {
        shapes = renderLine(swatch);
      } else {
        shapes = renderCircle(swatch);
      }
      return (
        <svg
          class={styles.swatch}
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ opacity: 'var(--legend-opacity, 1)' }}
          aria-hidden="true"
          data-swatch
        >
          {shapes}
        </svg>
      );
    };
  }
});
