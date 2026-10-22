import { defineComponent } from 'vue';
import styles from './DashboardAtmosphere.module.scss';

// 沿用旧版蜂窝坐标，只在入场阶段挂载；终态移除节点而不是持续绘制
const radius = 36;
const hexHeight = Math.sqrt(3) * radius;
const columns = Array.from({ length: 39 }, (_, index) => {
  const column = index - 19;
  const x = 960 + column * radius * 1.5;
  return {
    id: column,
    cells: Array.from({ length: 21 }, (_cell, row) => {
      const y = 540 + (row - 10 + Math.abs(column % 2) / 2) * hexHeight;
      return Array.from({ length: 6 }, (_point, corner) => {
        const angle = corner * Math.PI / 3;
        return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
      }).join(' ');
    })
  };
});

/** 环境层不接管鼠标与地图渲染，动画受页面可见性和减少动画控制 */
export const DashboardAtmosphere = defineComponent({
  name: 'DashboardAtmosphere',
  props: { entering: Boolean, reduced: Boolean },
  setup(props) {
    return () => (
      <div class={styles.atmosphere} aria-hidden="true">
        <div class={styles.wash} data-scene="wash" />
        {props.entering && !props.reduced && <div class={styles.honeycomb} data-scene="honeycomb">
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">{columns.map(column =>
            (
              <g key={column.id} style={{ animationDelay: `${Math.abs(column.id) * .055}s` }}>
                {column.cells.map((points, index) => <polygon key={index} points={points} />)}
              </g>
            ))}</svg>
        </div>}
        <div class={styles.grid} data-scene="grid">
          <div />
        </div>
        <div class={styles.haze} data-scene="haze"><i class={styles.hazeLeft} /><i class={styles.hazeRight} /></div>
        <div class={styles.particles} data-scene="particles">{Array.from({ length: 18 }, (_, index) =>
          (
            <i
              key={index}
              style={{
                left: `${8 + index * 37 % 84}%`,
                top: `${22 + index * 23 % 68}%`,
                '--particle-size': `${index % 3 + 2}px`,
                animationDuration: `${12 + index % 5 * 2}s`,
                animationDelay: `${-index * 1.3}s`
              }}
            />
          ))}</div>
      </div>
    );
  }
});
