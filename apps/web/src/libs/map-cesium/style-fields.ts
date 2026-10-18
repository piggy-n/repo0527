import {
  convertFilter, createExpression, type LayerSpecification, type StyleExpression, type VectorSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';

type Expression = StyleExpression['expression'];

/** 从规范库的表达式树提取字段；动态字段或整对象读取保留全部属性 */
export function styleFields(layer: LayerSpecification, source: VectorSourceSpecification): readonly string[] | null {
  const fields = new Set<string>();
  let all = false;
  const visit = (expression: Expression): void => {
    const children: Expression[] = [];
    expression.eachChild(child => children.push(child));
    if ('name' in expression) {
      if (expression.name === 'properties') {
        all = true;
      } else if ((expression.name === 'get' || expression.name === 'has') && children.length === 1) {
        const key = children[0];
        if ('value' in key && typeof key.value === 'string') {
          fields.add(key.value);
        } else {
          all = true;
        }
      }
    }
    children.forEach(visit);
  };
  const inspect = (value: unknown): void => {
    if (!Array.isArray(value)) {
      return;
    }
    const result = createExpression(value, `${layer.id}.fields`);
    if (result.result === 'success') {
      visit(result.value.expression);
    } else {
      // 属性编译由样式计划验证，这里不能因无法分析而误裁掉业务字段
      all = true;
    }
  };
  for (const value of Object.values(layer.paint ?? {})) {
    inspect(value);
  }
  for (const value of Object.values(layer.layout ?? {})) {
    inspect(value);
  }
  if ('filter' in layer && layer.filter !== undefined) {
    inspect(convertFilter(layer.filter));
  }
  const promote = source.promoteId;
  if (typeof promote === 'string') {
    fields.add(promote);
  } else if (promote && 'source-layer' in layer && layer['source-layer']) {
    const field = promote[layer['source-layer']];
    if (typeof field === 'string') {
      fields.add(field);
    }
  }
  return all ? null : [...fields].toSorted();
}
