/**
 * 包装外部传入的错误报告器：报告器自己抛错时改为打印到控制台（连同原始错误），不影响调用方后续的状态转换和资源释放。
 * label 用来在控制台里区分来源
 */
export function safeReporter(report: (error: unknown) => void, label: string): (error: unknown) => void {
  return error => {
    try {
      report(error);
    } catch (reporterError) {
      console.error(`[${label}] 错误报告器抛出了异常`, reporterError, error);
    }
  };
}
