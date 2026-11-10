/**
 * 库自己会重试的数据块错误（同 gaussian-splat-lite 1.6.1 的 streamRetryAt）：HTTP 408、425、429、5xx，
 * 网络错误（TypeError、NetworkError），Worker 被终止；带 fatal 的不重试。这些错误库照样交给 onError，
 * 重试成功以后只通知重画，不会说"好了"，所以不能当成失败报告出去。升级库时对一遍
 */
export function retriedByLibrary(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'fatal' in error && error.fatal) {
    return false;
  }
  if (error instanceof Error && error.name === 'WorkerTerminatedError') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = /\bHTTP (\d{3})\b/.exec(message)?.[1];
  if (status !== undefined) {
    const code = Number(status);
    return [408, 425, 429].includes(code) || code >= 500;
  }
  return error instanceof TypeError || (error instanceof Error && error.name === 'NetworkError');
}
