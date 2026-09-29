import { optimize, type PluginConfig } from 'svgo';

export interface NormalizedIcon {
  /** 写回文件的规范化 SVG */
  svg: string;
  viewBox: string;
  /** 根元素上需要在渲染时还原的展示属性 */
  attrs?: Record<string, string>;
  /** <svg> 内部的标记 */
  body: string;
}

// 根元素上的这些属性会被子元素继承，渲染时要还原到组件的 <svg> 上
const ROOT_ATTRS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'fill-rule',
  'clip-rule'
];

function createPlugins(name: string, multicolor: boolean): PluginConfig[] {
  return [
    // inlineStyles 默认只内联只被一个元素使用的样式，这里全部内联，之后再删除 <style>
    { name: 'preset-default', params: { overrides: { inlineStyles: { onlyMatchedOnce: false } } } },
    'convertStyleToAttrs',
    ...(multicolor ? [] : [{ name: 'convertColors', params: { currentColor: true } } satisfies PluginConfig]),
    'removeDimensions',
    'removeTitle',
    'removeScripts',
    // 内联 SVG 中的 <style> 会作用于整个页面
    'removeStyleElement',
    // 多个图标内联在同一页面时，渐变、裁剪路径的 id 不能重复；cleanupIds 先把 id 缩短，重复运行时结果不变
    { name: 'prefixIds', params: { prefix: name, delim: '-', prefixClassNames: false } },
    { name: 'removeAttrs', params: { attrs: ['class', 'data-.*'] } },
    'removeXMLNS'
  ];
}

const ROOT_PATTERN = /^<svg([^>]*?)\/?>([\s\S]*?)(?:<\/svg>)?$/;
const ATTR_PATTERN = /([\w:-]+)="([^"]*)"/g;

/** 规范化一个 SVG：去掉尺寸、脚本和样式表，单色图标的颜色改为 currentColor；同样的输入总是得到同样的输出 */
export function normalizeIcon(source: string, name: string, multicolor: boolean): NormalizedIcon {
  const { data } = optimize(source, { multipass: true, plugins: createPlugins(name, multicolor) });
  const match = ROOT_PATTERN.exec(data.trim());
  if (!match) {
    throw new Error(`${name}：不是有效的 SVG`);
  }

  const [, rootAttrText = '', body = ''] = match;
  const rootAttrs = new Map([...rootAttrText.matchAll(ATTR_PATTERN)].map(([, key, value]) => [key, value]));
  const viewBox = rootAttrs.get('viewBox');
  if (!viewBox) {
    throw new Error(`${name}：缺少 viewBox，也没有可换算的 width、height`);
  }

  const attrs: Record<string, string> = {};
  for (const key of ROOT_ATTRS) {
    const value = rootAttrs.get(key);
    // fill="currentColor" 与组件的默认值相同，不必记录
    if (value !== undefined && !(key === 'fill' && value === 'currentColor')) {
      attrs[key] = value;
    }
  }
  const hasAttrs = Object.keys(attrs).length > 0;
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attrText}>${body}</svg>\n`,
    viewBox,
    ...(hasAttrs ? { attrs } : {}),
    body
  };
}
