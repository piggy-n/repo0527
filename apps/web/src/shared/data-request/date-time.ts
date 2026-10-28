const pad = (value: number) => String(value).padStart(2, '0');

/** 数据申请的接口和日期选择器用的格式 YYYY-MM-DD HH:mm:ss，按本地时间 */
export function formatDateTime(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
