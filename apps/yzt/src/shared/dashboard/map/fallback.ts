import { init, registerMap, use } from 'echarts/core';
import { MapChart, type MapSeriesOption } from 'echarts/charts';
import { GeoComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';
import { DASHBOARD_CITIES } from '../cities';
import { formatValue } from '../calculations';
import type { IndicatorMeta } from '../model';
import type { DashboardRegions } from './region-geometry';
import type { MapValues } from './types';

use([MapChart, GeoComponent, LabelLayout, CanvasRenderer]);

// ECharts 的事件按城市名称对应回编码，其他形状的事件不算
function cityCode(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || !('name' in event)) {
    return null;
  }
  return DASHBOARD_CITIES.find(city => city.name === event.name)?.code ?? null;
}

/** 简化地图上的城市标签：名称下面写数值；没有数值或不显示数值时只写名称 */
export function fallbackLabel(
  name: string,
  value: number | null | undefined,
  indicator: Pick<IndicatorMeta, 'unit' | 'precision'>,
  showValues = true
): string {
  if (!showValues || value === null || value === undefined) {
    return name;
  }
  return `${name}\n${formatValue(value, indicator, indicator.unit.length <= 3)}`;
}

/** 二维降级沿用同一边界、值和色阶，不接入第二套地图服务 */
export function createFallback(
  container: HTMLElement,
  regions: DashboardRegions,
  hover: (code: string | null) => void,
  choose: (code: string) => void
) {
  registerMap('jiangsu-city-dashboard', regions.featureCollection);
  const chart = init(container, undefined, { devicePixelRatio: Math.min(devicePixelRatio || 1, 2) });
  chart.on('click', (event: unknown) => {
    const code = cityCode(event);
    if (code) {
      choose(code);
    }
  });
  chart.on('mousemove', (event: unknown) => hover(cityCode(event)));
  chart.on('mouseout', () => hover(null));
  chart.getZr().on('globalout', () => hover(null));
  return {
    update(
      values: MapValues,
      colors: Readonly<Record<string, string>>,
      indicator: Pick<IndicatorMeta, 'unit' | 'precision'>,
      showValues = true
    ): void {
      const series: MapSeriesOption = {
        type: 'map',
        map: 'jiangsu-city-dashboard',
        roam: false,
        layoutCenter: ['50%', '50%'],
        layoutSize: '94%',
        labelLayout: { moveOverlap: 'shiftY' },
        label: {
          show: true,
          fontFamily: 'Alibaba PuHuiTi',
          fontSize: 15,
          color: '#0E4894',
          textBorderColor: '#FFF',
          textBorderWidth: 3,
          formatter: item => {
            const city = DASHBOARD_CITIES.find(current => current.name === item.name);
            return fallbackLabel(item.name, city ? values[city.code] : null, indicator, showValues);
          }
        },
        // 悬停和选中的颜色沿用 ECharts 5 的默认值，6 的主题改成了浅黄
        emphasis: {
          label: { color: '#0E4894' },
          itemStyle: { areaColor: 'rgba(255,215,0,0.8)', borderColor: '#FFF', borderWidth: 2 }
        },
        select: { label: { color: 'rgb(100,0,0)' }, itemStyle: { color: 'rgba(255,215,0,0.8)' } },
        data: DASHBOARD_CITIES.map(city => ({
          name: city.name,
          value: values[city.code] ?? undefined,
          itemStyle: {
            areaColor: colors[city.code],
            borderColor: values[city.code] === null ? '#BCCBD8' : '#73E3FF',
            borderWidth: 1
          }
        }))
      };
      chart.setOption({ animation: false, series: [series] });
    },
    resize(): void {
      chart.resize();
    },
    capture(): HTMLCanvasElement {
      return chart.renderToCanvas({ pixelRatio: 2, backgroundColor: '#D3EFFD' });
    },
    dispose(): void {
      chart.dispose();
    }
  };
}
