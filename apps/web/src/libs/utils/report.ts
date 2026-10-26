/**
 * 包装外部传入的报告器（错误报告器，或报告其他情况的回调）：报告器自己抛错时改为打印到控制台（连同报告的内容），
 * 不影响调用方后续的状态转换和资源释放。label 用来在控制台里区分来源
 */
export function safeReporter<T = unknown>(report: (value: T) => void, label: string): (value: T) => void {
  return value => {
    try {
      report(value);
    } catch (reporterError) {
      console.error(`[${label}] 报告器抛出了异常`, reporterError, value);
    }
  };
}
