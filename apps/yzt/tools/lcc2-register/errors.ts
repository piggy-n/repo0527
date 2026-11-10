/** 输入不对（参数、文件、数据）时有意抛的错：命令行只打印一行原因；别的错是程序的问题，打印完整的错误和原因 */
export class ToolError extends Error {
  override name = 'ToolError';
}
