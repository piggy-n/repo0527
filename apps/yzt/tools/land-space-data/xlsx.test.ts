// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { childElement, formatDecimals, isPercentFormat, parseXml, readWorkbook, textContent } from './xlsx.ts';

// 拼一个只有 deflate 条目的 zip：读取时不校验 CRC，这里填 0
function zip(files: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    directory.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}

const MAIN = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

// 两段文字加一段注音：注音不算正文，_x000D_ 是回车
const RICH_TEXT = [
  '<x:r><x:t xml:space="preserve">A&amp;</x:t></x:r>',
  '<x:r><x:t>B_x000D_</x:t></x:r>',
  '<x:rPh><x:t>注音</x:t></x:rPh>'
].join('');

const BOOK = zip({
  'xl/workbook.xml': `<?xml version="1.0" encoding="utf-8"?><x:workbook ${MAIN} xmlns:r="urn:r">
    <x:sheets><x:sheet name="指标" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>`,
  'xl/_rels/workbook.xml.rels':
    '<Relationships><Relationship Target="/xl/worksheets/a.xml" Type="urn:sheet" Id="rId7"/></Relationships>',
  'xl/sharedStrings.xml': `<x:sst ${MAIN}><x:si><x:t>编码</x:t></x:si><x:si>${RICH_TEXT}</x:si></x:sst>`,
  'xl/styles.xml': `<x:styleSheet ${MAIN}><x:numFmts><x:numFmt numFmtId="164" formatCode="0.0%"/></x:numFmts>
    <x:cellStyleXfs><x:xf numFmtId="4"/></x:cellStyleXfs>
    <x:cellXfs><x:xf numFmtId="0"/><x:xf numFmtId="164"/><x:xf numFmtId="4"/></x:cellXfs></x:styleSheet>`,
  'xl/worksheets/a.xml': `<x:worksheet ${MAIN}><x:sheetData>
    <x:row r="2"><x:c r="A2" t="s"><x:v>0</x:v></x:c><x:c r="C2" s="1"><x:v>0.5748</x:v></x:c></x:row>
    <x:row r="3"><x:c r="B3" t="s"><x:v>1</x:v></x:c><x:c r="AA3" s="2"><x:v>12.5</x:v></x:c>
    <x:c r="AB3" t="inlineStr"><x:is><x:t>不适用</x:t></x:is></x:c><x:c r="AC3" s="2"/>
    <x:c r="AD3" s="2"><x:v></x:v></x:c><x:c r="AE3" t="s"><x:v/></x:c></x:row>
    <x:row r="4"><x:c r="A4" s="2"/><x:c r="B4"><x:v> </x:v></x:c></x:row>
    </x:sheetData></x:worksheet>`
});

describe('xlsx 的读取', () => {
  it('元素和属性去掉前缀，属性不论顺序按名称取', () => {
    const root = parseXml('<x:c xmlns:x="urn:x" t="s" r="B2"><x:v>3</x:v><!-- 注释 --></x:c>');
    expect(root.name).toBe('c');
    expect(root.attributes).toEqual({ t: 's', r: 'B2' });
    expect(textContent(root)).toBe('3');
    expect(childElement(root, 'v')?.name).toBe('v');
    expect(() => parseXml('<a><b></a>')).toThrow('不匹配');
  });

  it('按关系文件找到工作表，读出共享字符串、行内文字、数字和数字格式', () => {
    const book = readWorkbook(BOOK);
    expect(book.sheetNames).toEqual(['指标']);
    expect(book.sheet('指标')).toEqual(
      new Map([
        [
          2,
          new Map([
            [0, { value: '编码', format: 'General' }],
            [2, { value: 0.5748, format: '0.0%' }]
          ])
        ],
        [
          3,
          new Map([
            [1, { value: 'A&B\r', format: 'General' }],
            [26, { value: 12.5, format: '#,##0.00' }],
            [27, { value: '不适用', format: 'General' }]
          ])
        ]
      ])
    );
    expect(() => book.sheet('无')).toThrow('没有工作表「无」');
  });

  it('空的 <v> 没有值：不读成 0，也不读成第 0 个共享字符串', () => {
    const sheet = readWorkbook(BOOK).sheet('指标');
    expect([...(sheet.get(3)?.keys() ?? [])]).toEqual([1, 26, 27]);
    expect(sheet.has(4)).toBe(false);
  });

  it('数字格式显示的小数位和是否百分比：常规和文本没有小数位', () => {
    const formats = ['General', '@', '#,##0', '#,##0.00', '0.00%', '0.0%', '"1:"0.00', '#,##0.00;[Red](#,##0.00)'];
    expect(formats.map(format => formatDecimals(format))).toEqual([null, null, 0, 2, 2, 1, 2, 2]);
    expect(formats.filter(format => isPercentFormat(format))).toEqual(['0.00%', '0.0%']);
    expect(isPercentFormat('0.00"%"')).toBe(false);
  });
});
