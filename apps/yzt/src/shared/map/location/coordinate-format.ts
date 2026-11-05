import type { LngLat } from '@yzt/map-core';

export type Axis = 'lng' | 'lat';

/** 输入框和复制用的格式：度分秒或小数 */
export type CoordinateFormat = 'dms' | 'decimal';

export type CoordinateErrorReason =
  | 'empty'
  | 'unrecognized'
  | 'direction'
  | 'decimals'
  | 'minutes'
  | 'seconds'
  | 'range';

export type ParsedCoordinate =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: CoordinateErrorReason; readonly message: string };

const AXIS_NAME: Readonly<Record<Axis, string>> = { lng: '经度', lat: '纬度' };
const MAX: Readonly<Record<Axis, number>> = { lng: 180, lat: 90 };
const EXAMPLES: Readonly<Record<Axis, string>> = {
  lng: '118°46′40″、118 46 40 或 1184640',
  lat: '32°03′23″、32 3 23 或 320323'
};

// 方向写在开头或末尾；值是所属的轴和正负
const DIRECTIONS: Readonly<Record<string, readonly [Axis, 1 | -1]>> = {
  E: ['lng', 1],
  东经: ['lng', 1],
  W: ['lng', -1],
  西经: ['lng', -1],
  N: ['lat', 1],
  北纬: ['lat', 1],
  S: ['lat', -1],
  南纬: ['lat', -1]
};
const DIRECTION = /^(东经|西经|北纬|南纬|[ENWS])|(东经|西经|北纬|南纬|[ENWS])$/i;

// 一段数字和它可选的单位；单位决定放进度、分、秒的哪一格，没有单位时放进下一格
const TOKEN = /(\d+(?:\.\d+)?)\s*([°'"])?[\s,]*/y;
const UNIT_SLOT: Readonly<Record<string, number>> = { '°': 0, "'": 1, '"': 2 };

function failure(reason: CoordinateErrorReason, message: string): ParsedCoordinate {
  return { ok: false, reason, message };
}

// 全角数字、各种撇号和引号、汉字单位统一成半角的 ° ' "
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，、]/g, ',')
    .replace(/[－−—]/g, '-')
    .replace(/[º˚]|度/g, '°')
    .replace(/[″“”＂]|''|秒/g, '"')
    .replace(/[′‘’＇´]|分/g, "'")
    .trim();
}

// 连写的数字拆成度、分、秒：度的位数按轴的范围判断，不够"度 + 2 位分"时整段当作度
function splitPacked(integer: string, fraction: string, axis: Axis): string[] {
  const degreeDigits =
    axis === 'lng' ? (Number(integer.slice(0, 3)) <= 180 ? 3 : 2) : Number(integer.slice(0, 2)) <= 90 ? 2 : 1;
  if (integer.length < degreeDigits + 2) {
    return [integer + fraction];
  }
  const rest = integer.slice(degreeDigits);
  if (rest.length <= 2) {
    return [integer.slice(0, degreeDigits), rest + fraction];
  }
  return [integer.slice(0, degreeDigits), rest.slice(0, 2), rest.slice(2) + fraction];
}

// 按单位或顺序把各段数字放进度、分、秒；格式不对时为 null
function slotsOf(text: string, axis: Axis): string[] | null {
  const slots: string[] = [];
  let next = 0;
  let index = 0;
  let marked = false;
  while (index < text.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(text);
    if (!match) {
      return null;
    }
    const [, number = '', unit] = match;
    const slot = unit ? (UNIT_SLOT[unit] ?? next) : next;
    if (slot < next || slot > 2) {
      return null;
    }
    slots[slot] = number;
    next = slot + 1;
    marked ||= unit !== undefined;
    index = TOKEN.lastIndex;
  }
  if (slots.length === 1 && !marked) {
    const [integer = '', fraction] = (slots[0] ?? '').split('.');
    return splitPacked(integer, fraction === undefined ? '' : `.${fraction}`, axis);
  }
  return slots;
}

/** 识别一个经度或纬度（ADR 0037 第 2 条）：标准的度分秒、分隔或连写的数字、小数度、方向都认 */
export function parseCoordinate(input: string, axis: Axis): ParsedCoordinate {
  const name = AXIS_NAME[axis];
  let text = normalize(input);
  if (!text) {
    return failure('empty', `请输入${name}`);
  }
  let sign = 1;
  const direction = DIRECTION.exec(text);
  if (direction) {
    const token = (direction[1] ?? direction[2] ?? '').toUpperCase();
    const [directionAxis, directionSign] = DIRECTIONS[token] ?? [axis, 1];
    if (directionAxis !== axis) {
      const other = AXIS_NAME[directionAxis];
      return failure('direction', `这是${other}的写法，请填到${other}框`);
    }
    sign = directionSign;
    text = text.replace(DIRECTION, '').trim();
  }
  if (text.startsWith('-')) {
    sign = -sign;
    text = text.slice(1).trim();
  }
  const slots = slotsOf(text, axis);
  if (!slots || slots.length === 0) {
    return failure('unrecognized', `无法识别，可以写成 ${EXAMPLES[axis]}`);
  }
  const [degrees = 0, minutes = 0, seconds = 0] = Array.from(slots, value => Number(value ?? 0));
  // 只有最后一段可以带小数：118.5°30′ 说不清是什么意思
  if (slots.slice(0, -1).some(value => value?.includes('.'))) {
    return failure('decimals', '只有最后一段可以带小数');
  }
  if (minutes >= 60) {
    return failure('minutes', '分要小于 60');
  }
  if (seconds >= 60) {
    return failure('seconds', '秒要小于 60');
  }
  const value = sign * (degrees + minutes / 60 + seconds / 3600);
  if (Math.abs(value) > MAX[axis]) {
    return failure('range', `${name}要在 -${MAX[axis]}～${MAX[axis]} 之间`);
  }
  return { ok: true, value };
}

// 度分秒按百分之一秒取整后再拆，进位不会出现 60″
function toDms(value: number): string {
  const centiseconds = Math.round(Math.abs(value) * 360_000);
  const degrees = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6000);
  const seconds = (centiseconds % 6000) / 100;
  return `${degrees}°${String(minutes).padStart(2, '0')}′${seconds.toFixed(2).padStart(5, '0')}″`;
}

function toDecimal(value: number): string {
  // 加 0 把 -0 变成 0，免得显示 -0.000000
  return (Math.round(value * 1e6) / 1e6 + 0).toFixed(6);
}

/** 输入框里的写法：度分秒不带方向（负数带负号），小数 6 位 */
export function formatCoordinate(value: number, format: CoordinateFormat): string {
  if (format === 'decimal') {
    return toDecimal(value);
  }
  return `${value < 0 && toDms(value) !== '0°00′00.00″' ? '-' : ''}${toDms(value)}`;
}

/** 复制和位置信息里的一对坐标：小数"118.777800, 32.056500"，度分秒"118°46′40.00″E, 32°03′23.40″N" */
export function formatLngLat([lng, lat]: LngLat, format: CoordinateFormat): string {
  if (format === 'decimal') {
    return `${toDecimal(lng)}, ${toDecimal(lat)}`;
  }
  return `${toDms(lng)}${lng < 0 ? 'W' : 'E'}, ${toDms(lat)}${lat < 0 ? 'S' : 'N'}`;
}

// 看起来是一个完整的坐标：带小数点、单位或方向；"118, 46" 这类只有整数的当作度、分
function looksComplete(text: string): boolean {
  return /[.°'"]/.test(text) || DIRECTION.test(text);
}

/** 一次粘贴的一对坐标拆成经度、纬度：按逗号、分号、换行，或"…E …N"这样的方向，或两个空格分隔的小数；不是一对时为 null */
export function splitCoordinatePair(input: string): readonly [string, string] | null {
  const text = normalize(input);
  const candidates: (readonly string[])[] = [
    text.split(/\s*[,;\n]\s*/),
    /^(.+?(?:[EW]|东经|西经))\s*(.+)$/i.exec(text)?.slice(1) ?? [],
    /^((?:[EW]|东经|西经).+?)\s+((?:[NS]|北纬|南纬).+)$/i.exec(text)?.slice(1) ?? [],
    text.split(/\s+/).every(part => part.includes('.')) ? text.split(/\s+/) : []
  ];
  for (const [lng, lat, ...rest] of candidates) {
    if (
      lng !== undefined &&
      lat !== undefined &&
      rest.length === 0 &&
      looksComplete(lng) &&
      looksComplete(lat) &&
      parseCoordinate(lng, 'lng').ok &&
      parseCoordinate(lat, 'lat').ok
    ) {
      return [lng, lat];
    }
  }
  return null;
}

/** 纬度超过 90 而经度不超过 90：多半是把经纬度填反了 */
export function looksSwapped(lngText: string, latText: string): boolean {
  const lng = parseCoordinate(lngText, 'lng');
  const lat = parseCoordinate(latText, 'lat');
  return lng.ok && Math.abs(lng.value) <= 90 && !lat.ok && lat.reason === 'range';
}
