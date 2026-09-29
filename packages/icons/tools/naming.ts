const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 文件名以此结尾的图标保留原有颜色，其余图标的颜色统一改为 currentColor */
export const MULTICOLOR_SUFFIX = '-color';

/** 把文件名（不含扩展名）转成短横线命名；含中文等无法转换的字符时返回 undefined */
export function toIconName(fileBase: string): string | undefined {
  const name = fileBase
    .trim()
    // userAvatar → user-Avatar，SVGIcon → SVG-Icon
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return KEBAB_CASE.test(name) ? name : undefined;
}

export function isMulticolor(name: string): boolean {
  return name.endsWith(MULTICOLOR_SUFFIX);
}
