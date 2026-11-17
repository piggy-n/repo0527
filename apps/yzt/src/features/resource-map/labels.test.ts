// @vitest-environment node
import {
  createExpression,
  type ExpressionSpecification,
  type StylePropertySpecification,
  validateStyleMin,
  type VectorSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import type { Resource, ResourceGeometry } from './catalog';
import { labeledCodes, labelFieldsOf } from './label-fields';
import {
  codeDefaultLabel,
  emphasisLabelLayer,
  isLabelLayer,
  LABEL_FONT_NAMES,
  LABEL_PLACEHOLDER,
  labelsGroupOf,
  type LabelTarget,
  labelText,
  nextLabelOverride,
  PLACEMENTS_OF,
  pointReach,
  type ResourceLabel,
  resolveLabel,
  resourceLabelLayer,
  selectionLabelsGroup
} from './labels';

function resource(code: string, geometry: ResourceGeometry, minzoom?: number): Resource {
  return {
    code,
    name: code,
    geometry,
    years: [2025],
    categoryId: '测试',
    index: 0,
    ...(minzoom === undefined ? {} : { minzoom })
  };
}

function requiredLabel(subject: Resource): ResourceLabel {
  const label = codeDefaultLabel(subject);
  if (!label) {
    throw new Error(`资源 ${subject.code} 没有登记标注字段`);
  }
  return label;
}

const GEOMETRY: Readonly<Record<ResourceGeometry, ExpressionSpecification>> = {
  fill: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
  line: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  circle: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
};

const REACH = pointReach([{ shape: 'circle', size: 'M', strokeWidth: 1 }]);

function target(subject: Resource, label: ResourceLabel = requiredLabel(subject), opacity = 1): LabelTarget {
  return {
    code: subject.code,
    geometry: subject.geometry,
    source: `resources-${subject.code}`,
    sourceLayer: `${subject.code}_2025`,
    filter: GEOMETRY[subject.geometry],
    minzoom: subject.minzoom,
    label,
    reach: subject.geometry === 'circle' ? REACH : null,
    opacity
  };
}

const TEXT_SPEC = {
  type: 'string',
  'property-type': 'data-driven',
  expression: { interpolated: false, parameters: ['zoom', 'feature'] },
  transition: false
} as const satisfies StylePropertySpecification;

// 按 MapLibre 的语义求标注的文字
function textOf(field: string, properties: Record<string, unknown>): unknown {
  const parsed = createExpression(labelText(field), 'text-field', TEXT_SPEC);
  if (parsed.result !== 'success') {
    throw new Error(parsed.value.map(({ message }) => message).join('；'));
  }
  return parsed.value.evaluate({ zoom: 16 }, { type: 'Point', properties });
}

const XXP = resource('csxhjctb_xxp', 'circle');
const HYDL = resource('csxhjctb_hydl', 'line', 9);
const DLTB = resource('bgdc_dltb', 'fill');

describe('默认标注', () => {
  it('第一个登记的字段，12 号、普惠体常规、白色 1.5 描边，15 级起；点默认"下方"（用户 2026-11-16）', () => {
    expect(codeDefaultLabel(XXP)).toStrictEqual({
      field: 'name',
      font: 'regular',
      size: 12,
      color: '#374151',
      haloColor: '#FFFFFF',
      haloWidth: 1.5,
      placement: 'bottom',
      minzoom: 15,
      maxzoom: 20,
      overlap: false
    });
  });

  it('地类图斑也是 15 级起；水系深蓝中粗；线默认沿线、面默认中心', () => {
    expect(codeDefaultLabel(DLTB)).toMatchObject({ field: 'dlmc', minzoom: 15, placement: 'center' });
    expect(codeDefaultLabel(HYDL)).toMatchObject({
      field: 'name',
      font: 'semibold',
      color: '#0B4A78',
      placement: 'line'
    });
  });

  it('没有登记字段的资源不提供标注', () => {
    expect(codeDefaultLabel(resource('bgdc_ccwjq', 'fill'))).toBeNull();
    expect(labelFieldsOf('bgdc_ccwjq')).toStrictEqual([]);
  });

  it('覆盖里不认识的字段、这种几何用不了的放置方式用默认的；级别反了时最大级别跟着最小级别', () => {
    const defaults = requiredLabel(XXP);

    expect(resolveLabel(XXP, defaults, { field: 'dlmc', size: 16 })).toMatchObject({ field: 'dlmc', size: 16 });
    expect(resolveLabel(XXP, defaults, { field: 'unknown' }).field).toBe('name');
    expect(resolveLabel(XXP, defaults, { placement: 'line' }).placement).toBe('bottom');
    expect(resolveLabel(XXP, defaults, { minzoom: 16, maxzoom: 12 })).toMatchObject({ minzoom: 16, maxzoom: 16 });
  });

  it('点的放置是自动、右侧、下方；以前存下的"上方"哪种几何都不用了，用默认的，别的字段照旧（用户 2026-11-16）', () => {
    expect(PLACEMENTS_OF.circle).toStrictEqual(['auto', 'right', 'bottom']);
    expect(Object.values(PLACEMENTS_OF).flat()).not.toContain('top');
    expect(resolveLabel(XXP, requiredLabel(XXP), { placement: 'top', size: 16 })).toMatchObject({
      placement: 'bottom',
      size: 16
    });
    // 默认是别的放置方式时回到那一种
    const autoDefaults: ResourceLabel = { ...requiredLabel(XXP), placement: 'auto' };
    expect(resolveLabel(XXP, autoDefaults, { placement: 'top' }).placement).toBe('auto');
  });
});

describe('标注的覆盖', () => {
  const defaults = requiredLabel(XXP);

  it('只记和默认不同的字段，颜色按符号的写法规范化；改回默认就不再记', () => {
    const changed = nextLabelOverride(defaults, undefined, { size: 16, color: '#ff0000', haloColor: '#ffffff' });

    expect(changed).toStrictEqual({ size: 16, color: 'rgba(255, 0, 0, 1)' });
    expect(nextLabelOverride(defaults, changed, { size: 12 })).toStrictEqual({ color: 'rgba(255, 0, 0, 1)' });
    expect(nextLabelOverride(defaults, { color: '#FF0000' }, { color: '#374151' })).toStrictEqual({});
  });
});

describe('标注的文字', () => {
  it('字段的值转成文字；没有值、是后端的占位值 -9999 时为空，不画（水域线层的名称）', () => {
    expect(textOf('name', { name: '秦淮河' })).toBe('秦淮河');
    expect(textOf('tbbh', { tbbh: 305 })).toBe('305');
    expect(textOf('name', {})).toBe('');
    expect(textOf('name', { name: LABEL_PLACEHOLDER })).toBe('');
    expect(textOf('name', { name: -9999 })).toBe('');
  });
});

describe('点的文字让开点', () => {
  it('按各类里最大的点：定位针往上伸出针头，往下没有；描边算在里面', () => {
    const [low, , high] = pointReach([
      { shape: 'circle', size: 'M', strokeWidth: 1 },
      { shape: 'pin', size: 'S', strokeWidth: 0 }
    ]);

    expect(low?.zoom).toBe(6);
    expect(high?.zoom).toBe(16);
    // M 档 16 级半径 6：圆往上 6 + 1；S 档的定位针往上 2.4 倍半径
    expect(high?.side).toBe(7);
    expect(high?.down).toBe(7);
    expect(high?.up).toBeGreaterThan(7);
  });

  it('下方：文字的顶边在点的下面，收回字形顶上的 0.125 em，偏移按级别插值、单位是 em；加强标注按大 2 号的字号换算', () => {
    const layout = resourceLabelLayer(target(XXP)).layout ?? {};
    const emphasis = emphasisLabelLayer(target(XXP), 'a'.repeat(32)).layout ?? {};

    expect(layout['text-anchor']).toBe('top');
    // M 档的圆往下 3、5、7 像素，再空 3，除以 12 号字，减 0.125
    expect(layout['text-offset']).toStrictEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      ['literal', [0, 0.375]],
      12,
      ['literal', [0, 0.542]],
      16,
      ['literal', [0, 0.708]]
    ]);
    expect(emphasis['text-anchor']).toBe('top');
    expect(emphasis['text-offset']).toStrictEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      ['literal', [0, 0.304]],
      12,
      ['literal', [0, 0.446]],
      16,
      ['literal', [0, 0.589]]
    ]);
  });

  it('下方的定位针：针尖在要素的位置，文字只让开针尖的描边再空 3 像素，各级一样', () => {
    const reach = pointReach([{ shape: 'pin', size: 'M', strokeWidth: 1 }]);
    const layout = resourceLabelLayer({ ...target(XXP), reach }).layout ?? {};

    expect(layout['text-offset']).toStrictEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      ['literal', [0, 0.208]],
      12,
      ['literal', [0, 0.208]],
      16,
      ['literal', [0, 0.208]]
    ]);
  });

  it('自动：先右边、再左边、下面、上面，各自让开点', () => {
    const autoLabel: ResourceLabel = { ...requiredLabel(XXP), placement: 'auto' };
    const layout = resourceLabelLayer(target(XXP, autoLabel)).layout ?? {};

    expect(layout['text-variable-anchor-offset']).toStrictEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      ['literal', ['left', [0.5, 0], 'right', [-0.5, 0], 'top', [0, 0.375], 'bottom', [0, -0.5]]],
      12,
      ['literal', ['left', [0.667, 0], 'right', [-0.667, 0], 'top', [0, 0.542], 'bottom', [0, -0.667]]],
      16,
      ['literal', ['left', [0.833, 0], 'right', [-0.833, 0], 'top', [0, 0.708], 'bottom', [0, -0.833]]]
    ]);
    expect(layout['text-anchor']).toBeUndefined();
  });
});

describe('标注图层', () => {
  it('和资源共用数据源，ID 以 resource-labels 为前缀；级别不低于资源的最小显示级别，最大级别拉到头时不限制', () => {
    const lowLabel = { ...requiredLabel(HYDL), minzoom: 8, maxzoom: 17 };
    const layer = resourceLabelLayer(target(HYDL, lowLabel));

    expect(layer).toMatchObject({
      id: 'resource-labels-csxhjctb_hydl',
      type: 'symbol',
      source: 'resources-csxhjctb_hydl',
      'source-layer': 'csxhjctb_hydl_2025',
      minzoom: 9,
      maxzoom: 18
    });
    expect(resourceLabelLayer(target(XXP)).maxzoom).toBeUndefined();
    expect(isLabelLayer(layer.id)).toBe(true);
    expect(isLabelLayer('resources-csxhjctb_hydl')).toBe(false);
  });

  it('文字跟着图层的透明度，低于 10% 时按 10%（SDF 不画），0 仍是 0', () => {
    expect(resourceLabelLayer(target(XXP, requiredLabel(XXP), 0.5)).paint?.['text-opacity']).toBe(0.5);
    expect(resourceLabelLayer(target(XXP, requiredLabel(XXP), 0.05)).paint?.['text-opacity']).toBe(0.1);
    expect(resourceLabelLayer(target(XXP, requiredLabel(XXP), 0)).paint?.['text-opacity']).toBe(0);
  });

  it('线：沿线或水平（线的中间、文字不转）；压盖是文字之间允许重叠', () => {
    const along = resourceLabelLayer(target(HYDL)).layout;
    const horizontalLabel: ResourceLabel = { ...requiredLabel(HYDL), placement: 'horizontal', overlap: true };
    const horizontal = resourceLabelLayer(target(HYDL, horizontalLabel));

    expect(along).toMatchObject({ 'symbol-placement': 'line', 'text-allow-overlap': false });
    expect(horizontal.layout).toMatchObject({
      'symbol-placement': 'line-center',
      'text-rotation-alignment': 'viewport',
      'text-allow-overlap': true
    });
  });

  it('加强标注的要素原来的标注滤掉：按 guid', () => {
    const layer = resourceLabelLayer(target(DLTB), 'a'.repeat(32));

    expect(layer.filter).toStrictEqual(['all', GEOMETRY.fill, ['!=', ['to-string', ['get', 'guid']], 'a'.repeat(32)]]);
  });

  it('加强标注：只画这个要素，中粗、大 2 号、红字白描边，始终显示、不挡别的标注，不跟着透明度', () => {
    const layer = emphasisLabelLayer(target(DLTB, requiredLabel(DLTB), 0.3), 'a'.repeat(32));

    expect(layer.id).toBe('selection-labels-bgdc_dltb');
    expect(layer.filter).toStrictEqual(['all', GEOMETRY.fill, ['==', ['to-string', ['get', 'guid']], 'a'.repeat(32)]]);
    expect(layer.layout).toMatchObject({
      'text-font': ['Alibaba PuHuiTi SemiBold', 'Alibaba PuHuiTi'],
      'text-size': 14,
      'text-allow-overlap': true,
      'text-ignore-placement': true
    });
    expect(layer.paint).toStrictEqual({
      'text-color': '#f5222d',
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 2,
      'text-halo-blur': 0.5
    });
  });

  it('分组从下到上是面、线、点（上面的先放，点 > 线 > 面），同一种几何按面板的先后；只引用资源的数据源', () => {
    const upper = resource('csxhjctb_xxa', 'fill');
    // 面板从上到下：学校点、地类图斑、水域线、学校面
    const group = labelsGroupOf([target(XXP), target(DLTB), target(HYDL), target(upper)], null);

    expect(group.sources).toStrictEqual({});
    expect(group.layers.map(layer => layer.id)).toStrictEqual([
      'resource-labels-csxhjctb_xxa',
      'resource-labels-bgdc_dltb',
      'resource-labels-csxhjctb_hydl',
      'resource-labels-csxhjctb_xxp'
    ]);
  });

  it('selection-labels 分组：有要素时一个加强标注，否则为空', () => {
    expect(selectionLabelsGroup(null, null)).toStrictEqual({ sources: {}, layers: [] });
    expect(selectionLabelsGroup(target(XXP), 'b'.repeat(32)).layers.map(layer => layer.id)).toStrictEqual([
      'selection-labels-csxhjctb_xxp'
    ]);
  });
});

describe('每个登记了字段的资源的标注图层都通过样式校验（ADR 0160）', () => {
  // 目录接口才给出几何，这里每种几何都试；字段、字体、放置方式、加强标注各试一遍，样式不写 glyphs
  const source: VectorSourceSpecification = { type: 'vector', tiles: ['http://localhost/{z}/{x}/{y}.pbf'], maxzoom: 15 };
  const codes = labeledCodes();

  it('登记的资源都有字段，字段名不重复', () => {
    expect(codes.length).toBeGreaterThan(60);
    const wrong = codes.filter(code => {
      const fields = labelFieldsOf(code).map(option => option.field);
      return fields.length === 0 || new Set(fields).size !== fields.length;
    });
    expect(wrong).toStrictEqual([]);
  });

  it.each(codes)('%s', code => {
    const errors = (['fill', 'line', 'circle'] as const).flatMap(geometry => {
      const subject = resource(code, geometry, 8);
      const defaults = requiredLabel(subject);
      const layers = labelFieldsOf(code).flatMap(({ field }) =>
        PLACEMENTS_OF[geometry].flatMap(placement =>
          LABEL_FONT_NAMES.map(font => resourceLabelLayer(target(subject, { ...defaults, field, placement, font })))
        )
      );
      // 同一个资源的几种写法放在一份样式里校验，ID 加上序号
      const all = [...layers, emphasisLabelLayer(target(subject), 'c'.repeat(32))];
      all.forEach((layer, index) => Object.assign(layer, { id: `${layer.id}-${index}` }));
      return validateStyleMin({ version: 8, sources: { [`resources-${code}`]: source }, layers: all }).map(
        ({ message }) => `${geometry}：${message}`
      );
    });

    expect(errors).toStrictEqual([]);
  });
});
