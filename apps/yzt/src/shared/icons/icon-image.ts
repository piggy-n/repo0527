import type { IconData } from '@mx/icons';
import icons from './icons.json';
import type { IconName } from './SvgIcon';

/** 图标的 SVG 文本，供画布绘制；属性与 SvgIcon 相同，单色图标的 currentColor 取 color */
export function iconMarkup(name: IconName, size: number, color = '#000000'): string {
  const icon: IconData = icons[name];
  const attributes = Object.entries({ fill: 'currentColor', ...icon.attrs })
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${size}" height="${size}" ` +
    `color="${color}" ${attributes}>${icon.body}</svg>`
  );
}

/** 把图标解码成图片，画进画布（如导出图片里的指北针）；页面上仍用 SvgIcon */
export async function loadIconImage(name: IconName, size: number, color?: string): Promise<HTMLImageElement> {
  const image = new Image(size, size);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconMarkup(name, size, color))}`;
  await image.decode();
  return image;
}
