/** 清理响应头中的路径和不能用于下载文件名的字符，保留中文 */
function cleanFileName(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? '';
  // oxlint-disable-next-line no-control-regex -- 下载名称不能包含响应头携带的控制字符
  const name = leaf.replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]/g, '').trim().replace(/[. ]+$/, '');
  // Windows 的设备名不能作为普通文件名，扩展名不改变这个限制
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

/** 解码百分号编码，不完整时返回 null */
function decodePercent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** 优先使用 UTF-8 filename*，其次 filename，最后使用业务提供的名称 */
export function downloadFileName(disposition: string | null, fallbackName: string): string {
  let extended = '';
  let regular = '';
  const fields = disposition?.matchAll(/(?:^|;)\s*(filename\*?)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/gi) ?? [];
  // 两个分组都是必有的，匹配到了就有值
  for (const [, key, raw] of fields) {
    const value = raw.trim().replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1');
    if (key.toLowerCase() === 'filename*') {
      const match = /^utf-8'[^']*'(.*)$/i.exec(value);
      // 不完整的百分号编码回退到普通名称，不猜测服务器编码
      const decoded = match && decodePercent(match[1]);
      if (decoded) {
        extended = cleanFileName(decoded);
      }
    } else {
      // 后端可能把编码过的名称放在普通 filename 里；解不开说明名称里本来就有 %，保留原样
      regular = cleanFileName(decodePercent(value) ?? value);
    }
  }
  return extended || regular || cleanFileName(fallbackName) || '文件';
}
