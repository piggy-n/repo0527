/** 站点或清单写错、服务器连不上这类输入问题：命令行只打印一行原因，构建直接失败 */
export class SiteError extends Error {
  override name = 'SiteError';
}
