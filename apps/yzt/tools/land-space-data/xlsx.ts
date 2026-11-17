import { inflateRawSync } from 'node:zlib';

// 只读 xlsx 的单元格：按中央目录解 zip，元素名去掉前缀（x:）后解析 XML，不引入依赖

const END_OF_DIRECTORY = Buffer.from('PK\x05\x06', 'latin1');
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const ZIP64_MARK = 0xffffffff;

/** 解出 zip 里的全部文件：键是包内路径 */
export function readZip(archive: Buffer): ReadonlyMap<string, Buffer> {
  const end = archive.lastIndexOf(END_OF_DIRECTORY);
  if (end < 0) {
    throw new Error('不是 zip 文件：找不到中央目录结尾');
  }
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(cursor) !== DIRECTORY_ENTRY) {
      throw new Error(`zip 中央目录第 ${index + 1} 项损坏`);
    }
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (compressedSize === ZIP64_MARK || localOffset === ZIP64_MARK) {
      throw new Error(`zip 里 ${name} 是 ZIP64 格式，不支持`);
    }
    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(`zip 里 ${name} 的本地文件头损坏`);
    }
    // 本地文件头的扩展字段可能和中央目录里的不一样长，按本地头自己的长度跳过
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === STORED) {
      files.set(name, data);
    } else if (method === DEFLATED) {
      files.set(name, inflateRawSync(data));
    } else {
      throw new Error(`zip 里 ${name} 用了不支持的压缩方式 ${method}`);
    }
  }
  return files;
}

export interface XmlElement {
  /** 去掉前缀后的元素名 */
  readonly name: string;
  /** 去掉前缀后的属性名；命名空间声明不收 */
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

export type XmlNode = XmlElement | string;

// 分组依次是 CDATA、结束标签、开始标签的名称、属性、自闭合的斜杠、文字；属性值里可能有未转义的 >，按引号整段跳过
const TOKEN = new RegExp(
  [
    String.raw`<!--[\s\S]*?-->`,
    String.raw`<\?[\s\S]*?\?>`,
    String.raw`<!\[CDATA\[([\s\S]*?)\]\]>`,
    String.raw`<!DOCTYPE[^>]*>`,
    String.raw`<\/([^\s>]+)\s*>`,
    String.raw`<([^\s/>]+)((?:[^>"'/]|\/(?!>)|"[^"]*"|'[^']*')*)(\/?)>`,
    String.raw`([^<]+)`
  ].join('|'),
  'g'
);
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
    if (hex !== undefined) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    if (decimal !== undefined) {
      return String.fromCodePoint(Number.parseInt(decimal, 10));
    }
    return NAMED_ENTITIES[named ?? ''] ?? '';
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name = '', double, single] of source.matchAll(ATTRIBUTE)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) {
      continue;
    }
    attributes[localName(name)] = decodeEntities(double ?? single ?? '');
  }
  return attributes;
}

interface OpenElement {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlNode[];
}

const isElement = (node: XmlNode): node is XmlElement => typeof node !== 'string';

/** 解析整份 XML，返回根元素 */
export function parseXml(source: string): XmlElement {
  // 根元素外面的文字、注释先挂在 holder 上，最后从中取出根元素
  const holder: OpenElement = { name: '', attributes: {}, children: [] };
  const stack: OpenElement[] = [];
  const current = () => stack.at(-1) ?? holder;
  for (const [, cdata, closing, opening, attributes = '', selfClosing, text] of source.matchAll(TOKEN)) {
    if (cdata !== undefined) {
      current().children.push(cdata);
    } else if (text !== undefined) {
      current().children.push(decodeEntities(text));
    } else if (closing !== undefined) {
      if (stack.pop()?.name !== localName(closing)) {
        throw new Error(`XML 的结束标签 </${closing}> 不匹配`);
      }
    } else if (opening !== undefined) {
      const element: OpenElement = { name: localName(opening), attributes: parseAttributes(attributes), children: [] };
      current().children.push(element);
      if (!selfClosing) {
        stack.push(element);
      }
    }
  }
  const root = holder.children.find(isElement);
  if (stack.length > 0 || root === undefined) {
    throw new Error('XML 不完整');
  }
  return root;
}

/** 直接子元素里名为 name 的 */
export function childElements(element: XmlElement | undefined, name: string): XmlElement[] {
  return (element?.children ?? []).filter(isElement).filter(child => child.name === name);
}

/** 第一个名为 name 的直接子元素 */
export function childElement(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return childElements(element, name)[0];
}

/** 元素下的全部文字；skip 里的子元素（如共享字符串的注音 rPh）整棵跳过 */
export function textContent(element: XmlElement, skip: readonly string[] = []): string {
  return element.children
    .map(child => {
      if (typeof child === 'string') {
        return child;
      }
      return skip.includes(child.name) ? '' : textContent(child, skip);
    })
    .join('');
}

// Excel 把 XML 里写不了的字符记成 _xHHHH_，下划线本身记成 _x005F_
const decodeExcelEscapes = (text: string) =>
  text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

export interface Cell {
  /** 文本是字符串，数值是数字，布尔是 true / false；空单元格不出现 */
  readonly value: string | number | boolean;
  /** 数字格式代码，如 0.00、0.00%、#,##0；常规是 General */
  readonly format: string;
}

/** 一行：键是列号（A 列是 0） */
export type Row = ReadonlyMap<number, Cell>;

export interface Workbook {
  readonly sheetNames: readonly string[];
  /** 工作表的全部行：键是行号（从 1 开始），没有内容的行不出现 */
  sheet(name: string): ReadonlyMap<number, Row>;
}

// ECMA-376 第 1 部分 18.8.30 的内置数字格式，只列能推出小数位的；日期、时间按常规处理
const BUILT_IN_FORMATS: Readonly<Record<number, string>> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  48: '##0.0E+0',
  49: '@'
};

function columnIndex(reference: string): number {
  let index = 0;
  for (const letter of /^[A-Z]+/.exec(reference)?.[0] ?? '') {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

// 关系的属性顺序不固定，按名称取；Target 可能相对 xl/，也可能从包根开始
function relationshipTargets(rels: XmlElement): ReadonlyMap<string, string> {
  return new Map(
    childElements(rels, 'Relationship').map(({ attributes }) => {
      const target = attributes.Target ?? '';
      return [attributes.Id ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`];
    })
  );
}

// 单元格的 s 是 cellXfs 里的序号；cellStyleXfs 里的 xf 是单元格样式，不能混进来
function cellFormats(styles: XmlElement | undefined): readonly string[] {
  const custom = new Map(
    childElements(childElement(styles, 'numFmts'), 'numFmt').map(({ attributes }) => [
      Number(attributes.numFmtId),
      attributes.formatCode ?? 'General'
    ])
  );
  return childElements(childElement(styles, 'cellXfs'), 'xf').map(({ attributes }) => {
    const id = Number(attributes.numFmtId ?? 0);
    return custom.get(id) ?? BUILT_IN_FORMATS[id] ?? 'General';
  });
}

function cellValue(cell: XmlElement, sharedStrings: readonly string[]): string | number | boolean | undefined {
  const type = cell.attributes.t ?? 'n';
  if (type === 'inlineStr') {
    const inline = childElement(cell, 'is');
    return inline ? decodeExcelEscapes(textContent(inline, ['rPh'])) : undefined;
  }
  const raw = childElement(cell, 'v');
  if (!raw) {
    return undefined;
  }
  const text = textContent(raw);
  // <v/>、<v></v> 没有值：不能读成 0，也不能读成第 0 个共享字符串
  if (text.trim() === '') {
    return undefined;
  }
  if (type === 's') {
    const shared = sharedStrings[Number(text)];
    if (shared === undefined) {
      throw new Error(`单元格 ${cell.attributes.r ?? ''} 引用了不存在的共享字符串 ${text}`);
    }
    return shared;
  }
  if (type === 'b') {
    return text === '1';
  }
  if (type === 'n') {
    return Number(text);
  }
  // str（公式的文字结果）、e（错误值）按文字保留
  return decodeExcelEscapes(text);
}

function readSheet(sheet: XmlElement, sharedStrings: readonly string[], formats: readonly string[]) {
  const rows = new Map<number, Row>();
  let rowNumber = 0;
  for (const row of childElements(childElement(sheet, 'sheetData'), 'row')) {
    // r 可以省略，省略时紧接上一行、上一格
    rowNumber = row.attributes.r ? Number(row.attributes.r) : rowNumber + 1;
    const cells = new Map<number, Cell>();
    let column = -1;
    for (const cell of childElements(row, 'c')) {
      column = cell.attributes.r ? columnIndex(cell.attributes.r) : column + 1;
      const value = cellValue(cell, sharedStrings);
      if (value !== undefined) {
        cells.set(column, { value, format: formats[Number(cell.attributes.s ?? 0)] ?? 'General' });
      }
    }
    if (cells.size > 0) {
      rows.set(rowNumber, cells);
    }
  }
  return rows;
}

/** 打开 xlsx：先读工作簿、关系、共享字符串和样式，工作表在取用时解析 */
export function readWorkbook(archive: Buffer): Workbook {
  const files = readZip(archive);
  const xml = (path: string) => {
    const file = files.get(path);
    return file ? parseXml(file.toString('utf8')) : undefined;
  };
  const workbook = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) {
    throw new Error('xlsx 缺少 xl/workbook.xml 或它的关系文件');
  }
  const targets = relationshipTargets(rels);
  const sheets = new Map(
    childElements(childElement(workbook, 'sheets'), 'sheet').map(({ attributes }) => [
      attributes.name ?? '',
      targets.get(attributes.id ?? '')
    ])
  );
  const shared = xml('xl/sharedStrings.xml');
  const sharedStrings = childElements(shared, 'si').map(item => decodeExcelEscapes(textContent(item, ['rPh'])));
  const formats = cellFormats(xml('xl/styles.xml'));
  return {
    sheetNames: [...sheets.keys()],
    sheet(name) {
      const path = sheets.get(name);
      const sheet = path === undefined ? undefined : xml(path);
      if (!sheet) {
        throw new Error(`xlsx 里没有工作表「${name}」`);
      }
      return readSheet(sheet, sharedStrings, formats);
    }
  };
}

// 数字格式的正数段，去掉引号里的文字、转义的字符和 [颜色]、[条件] 这类方括号
function positiveSection(format: string): string {
  const [positive = ''] = format
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .split(';');
  return positive;
}

/** 数字格式显示的小数位（0.00% 是 2）；常规、文本这类不定位数的格式为 null */
export function formatDecimals(format: string): number | null {
  const positive = positiveSection(format);
  if (!/[0#?]/.test(positive)) {
    return null;
  }
  const point = positive.indexOf('.');
  return point < 0 ? 0 : (/^[0#?]*/.exec(positive.slice(point + 1))?.[0].length ?? 0);
}

/** 百分比格式：单元格存的是小数，显示时乘 100 */
export function isPercentFormat(format: string): boolean {
  return positiveSection(format).includes('%');
}
