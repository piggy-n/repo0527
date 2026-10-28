const pad = (value: number) => String(value).padStart(2, '0');

/** 数据申请的接口和日期选择器用的格式 YYYY-MM-DD HH:mm:ss，按本地时间 */
export function formatDateTime(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 后端按北京时间记录：消息的时间直接是北京时间的字符串，申请的时间是带时区的 ISO。
// 申请的时间也显示成北京时间，和消息里的一致，不随浏览器所在的时区变化
const beijingFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

/** 按北京时间写成 YYYY-MM-DD HH:mm:ss */
export function formatBeijingDateTime(date: Date): string {
  const parts = Object.fromEntries(beijingFormat.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
