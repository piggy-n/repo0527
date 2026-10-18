import {
  createPropertyExpression,
  featureFilter,
  latest,
  normalizePropertyExpression,
  type Feature,
  type FilterSpecification,
  type StylePropertySpecification
} from '@maplibre/maplibre-gl-style-spec';

type BasicLayerType = 'background' | 'raster' | 'fill' | 'line' | 'circle';

/** 编译后的样式属性，保留规范库的颜色等结果类型 */
export interface CompiledStyleProperty {
  readonly zoomDependent: boolean;
  evaluate(zoom: number, feature?: Feature): unknown;
}

/** 编译后的要素过滤条件 */
export interface CompiledStyleFilter {
  readonly zoomDependent: boolean;
  test(zoom: number, feature: Feature): boolean;
}

// 当前镜像只提供级别与要素属性，缺失的输入不能静默使用默认值
const UNSUPPORTED_CONTEXT = new Set([
  'feature-state',
  'global-state',
  'image',
  'line-progress',
  'heatmap-density',
  'elevation',
  'accumulated',
  'is-supported-script'
]);

// 这里只检查所需输入，不参与表达式求值；literal 内容和 match 标签属于数据
function expressionInputs(value: unknown, location: string, inputs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    const operator = items[0];
    if (operator === 'literal') {
      return inputs;
    }
    if (operator === 'semiliteral' && Array.isArray(items[1])) {
      for (const child of items[1] as readonly unknown[]) {
        expressionInputs(child, location, inputs);
      }
      return inputs;
    }
    if (typeof operator === 'string') {
      if (UNSUPPORTED_CONTEXT.has(operator)) {
        throw new Error(`${location}：三维基础样式暂不支持 ${operator} 表达式`);
      }
      inputs.add(operator);
    }
    for (let index = typeof operator === 'string' ? 1 : 0; index < items.length; index += 1) {
      if (operator === 'match' && index >= 2 && index < items.length - 1 && index % 2 === 0) {
        continue;
      }
      expressionInputs(items[index], location, inputs);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) {
      expressionInputs(child, location, inputs);
    }
  }
  return inputs;
}

/** 使用二维同一份属性规范编译基础图层样式 */
export function compileStyleProperty(
  layerType: BasicLayerType,
  property: string,
  value: unknown
): CompiledStyleProperty {
  const paint: Record<string, unknown> = latest[`paint_${layerType}`];
  const layout: Record<string, unknown> = latest[`layout_${layerType}`];
  const reference = paint[property] ?? layout[property];
  if (!reference) {
    throw new Error(`${layerType}.${property}：未知样式属性`);
  }
  // latest 是规范 JSON，公开类型把 type 扩宽为 string，这里恢复属性规范的联合类型
  const specification = reference as StylePropertySpecification;
  const location = `${layerType}.${property}`;
  const resolved = value === undefined ? specification.default : value;
  const inputs = expressionInputs(resolved, location);
  if (inputs.has('within') || inputs.has('distance')) {
    throw new Error(`${location}：三维基础样式暂不支持需要瓦片几何的表达式`);
  }
  // 无默认值的可选属性保留 undefined，由渲染器按属性间的回退关系处理
  if (resolved === undefined) {
    const compiled = normalizePropertyExpression(undefined, location, specification);
    return {
      zoomDependent: false,
      evaluate: (zoom, feature) => {
        const result: unknown = compiled.evaluate({ zoom }, feature);
        return result;
      }
    };
  }
  const expression = Array.isArray(resolved) && typeof resolved[0] !== 'string'
    ? ['literal', resolved]
    : resolved;
  const compiled = createPropertyExpression(expression, location, specification);
  if (compiled.result === 'error') {
    throw new Error(`${location}：${compiled.value.map(error => `${error.key}: ${error.message}`).join(', ')}`);
  }
  return {
    zoomDependent: compiled.value.kind === 'camera' || compiled.value.kind === 'composite',
    evaluate: (zoom, feature) => {
      const result: unknown = compiled.value.evaluate({ zoom }, feature);
      return result;
    }
  };
}

/** 使用规范库处理表达式与旧式过滤器，拒绝缺少瓦片几何的空间过滤 */
export function compileStyleFilter(
  filter: FilterSpecification | undefined,
  layerId: string
): CompiledStyleFilter {
  const location = `${layerId}.filter`;
  const inputs = expressionInputs(filter, location);
  const compiled = featureFilter(filter, location);
  if (compiled.needGeometry) {
    throw new Error(`${location}：三维基础样式暂不支持需要瓦片几何的过滤条件`);
  }
  return {
    zoomDependent: inputs.has('zoom'),
    test: (zoom, feature) => compiled.filter({ zoom }, feature)
  };
}
