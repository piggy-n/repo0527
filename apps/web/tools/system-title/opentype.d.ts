// opentype.js 2.0 没有自带类型，@types/opentype.js 对应 1.3；这里只声明生成标题轮廓用到的部分
// 直接导入 ESM 文件：包名解析时，Node 取 main 指向的 UMD（只有默认导出），lint 取 module 指向的 ESM（只有具名导出），二者不一致
declare module 'opentype.js/dist/opentype.mjs' {
  interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  interface Path {
    getBoundingBox(): BoundingBox;
    toPathData(decimalPlaces?: number): string;
  }

  interface RenderOptions {
    /** 字间距，以 em 为单位 */
    letterSpacing?: number;
  }

  interface Font {
    unitsPerEm: number;
    tables: { os2: { sTypoAscender: number; sTypoDescender: number } };
    getPath(text: string, x: number, y: number, fontSize: number, options?: RenderOptions): Path;
    getAdvanceWidth(text: string, fontSize: number, options?: RenderOptions): number;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
