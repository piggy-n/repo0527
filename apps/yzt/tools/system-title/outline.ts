import { parse } from 'opentype.js/dist/opentype.mjs';

export interface OutlineShape {
  viewBox: string;
  path: string;
}

/** 用字体把文字转成 SVG 轮廓；纵向取字体的 em 框，SVG 设置 height: 1em 时与同字号文字一样大；letterSpacing 以 em 为单位 */
export function createTitleOutline(fontData: ArrayBuffer, text: string, letterSpacing = 0): OutlineShape {
  const font = parse(fontData);
  const { sTypoAscender: ascender, sTypoDescender: descender } = font.tables.os2;

  // 以字体单位作为坐标，基线放在 y = ascender，em 框的顶端就是 y = 0
  const fontSize = font.unitsPerEm;
  const options = { letterSpacing };
  const path = font.getPath(text, 0, ascender, fontSize, options);
  const box = path.getBoundingBox();
  // opentype.js 在最后一个字形后面也加了字间距，去掉它，否则居中时整体偏左
  const advance = font.getAdvanceWidth(text, fontSize, options) - letterSpacing * fontSize;

  // 倾斜字形可能超出步进宽度，横向取二者的并集，避免右侧被裁掉
  const left = Math.floor(Math.min(0, box.x1));
  const right = Math.ceil(Math.max(advance, box.x2));

  return {
    viewBox: `${left} 0 ${right - left} ${ascender - descender}`,
    path: path.toPathData(1)
  };
}
