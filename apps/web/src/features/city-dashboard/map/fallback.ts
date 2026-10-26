import { init, registerMap, use } from 'echarts/core';
import { MapChart, type MapSeriesOption } from 'echarts/charts';
import { GeoComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';
import { CITIES } from '../catalog';
import { formatValue } from '../calculations';
import type { Indicator } from '../model';
import type { DashboardRegions } from './region-geometry';
import type { MapValues } from './types';

use([MapChart, GeoComponent, LabelLayout, CanvasRenderer]);

// ECharts 的事件按城市名称对应回编码，其他形状的事件不算
function cityCode(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || !('name' in event)) {
    return null;
  }
  return CITIES.find(city => city.name === event.name)?.code ?? null;
}

// 简化地图上城市名称下面的数值；没有数值时只写名称
function cityLabel(name: string, value: number | null | undefined, indicator: Indicator): string {
  if (value === null || value === undefined) {
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
    update(values: MapValues, colors: Readonly<Record<string, string>>, indicator: Indicator): void {
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
            const city = CITIES.find(current => current.name === item.name);
            return cityLabel(item.name, city ? values[city.code] : null, indicator);
          }
        },
        emphasis: { label: { color: '#0E4894' }, itemStyle: { borderColor: '#FFF', borderWidth: 2 } },
        data: CITIES.map(city => ({
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
