import { findRegion } from '@/shared/map/region/region-catalog';
import { NATURAL_RULES } from './config';
import type { QueryCondition, QueryLayer, QueryModule } from './types';

/** 字符串字面量使用 SQL 标准单引号转义，后端仍须校验查询表达式 */
export function quoteValue(value: string | number): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** 字段来自固定配置，不接受表单自定义字段名；0 是有效数值 */
export function buildConditions(
  layer: QueryLayer,
  conditions: readonly QueryCondition[],
  relation: 'AND' | 'OR'
): string {
  const expressions: string[] = [];
  for (const { code, value, operator } of conditions) {
    const field = layer.fields.find(item => item.code === code);
    if (!field) {
      throw new Error('查询字段已变化，请重新选择条件');
    }
    if (value === '' || (Array.isArray(value) && !value.length)) {
      continue;
    }
    const { options } = field;
    if (options) {
      const values = Array.isArray(value) ? value : [String(value)];
      if (values.some(item => !options.some(option => option.code === item))) {
        throw new Error(`${field.label}包含无效选项`);
      }
      expressions.push(`${code} IN (${values.map(quoteValue).join(', ')})`);
    } else {
      if (Array.isArray(value) || (field.numeric && !Number.isFinite(Number(value)))) {
        throw new Error(`请填写有效的${field.label}`);
      }
      if (field.operators && !field.operators.includes(operator)) {
        throw new Error(`请选择${field.label}的比较方式`);
      }
      const comparison = operator === 'NOT' ? 'NOT LIKE' : operator;
      const literal = comparison.includes('LIKE') ? `%${value}%` : value;
      expressions.push(`${code} ${comparison} ${quoteValue(literal)}`);
    }
  }
  return expressions.map(expression => `(${expression})`).join(` ${relation} `);
}

/** 高级查询只收条件表达式；这是输入提示，不代替服务端参数化与授权校验 */
export function advancedConditions(text: string): string {
  const expression = text.trim();
  if (!expression) {
    throw new Error('请填写查询条件');
  }
  const outsideStrings = expression.replace(/'(?:''|[^'])*'/g, '');
  const statement = /;|--|\/\*|\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION)\b/i;
  if (outsideStrings.includes("'") || statement.test(outsideStrings)) {
    throw new Error('请填写完整的筛选条件，不包含 SQL 语句、注释或分号');
  }
  return expression;
}

/** 精确示例匹配，避免宽泛关键词把更具体的区域和条件吞掉 */
export function matchNatural(module: QueryModule, text: string) {
  const normalized = text.replace(/\s+/g, '');
  const rule = NATURAL_RULES[module].find(item => item.text.replace(/\s+/g, '') === normalized);
  if (!rule) {
    throw new Error('当前仅支持下方示例，请选择示例或使用属性、高级查询');
  }
  return {
    ...rule,
    conditions: rule.field && rule.values ? `${rule.field} IN (${rule.values.map(quoteValue).join(', ')})` : ''
  };
}

export function regionName(code: string): string {
  return code === '320000' ? '江苏省' : findRegion(code)?.name ?? code;
}
