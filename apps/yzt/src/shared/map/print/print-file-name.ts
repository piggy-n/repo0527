const pad = (value: number) => String(value).padStart(2, '0');

/** 导出图片的文件名（ADR 0174）：名称-年月日-时分秒.png，按本地时间，如"现状底图-20261124-014530.png" */
export function printFileName(name: string, date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${name}-${day}-${time}.png`;
}
