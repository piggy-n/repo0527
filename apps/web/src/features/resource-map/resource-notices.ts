export interface ResourceNoticeInput {
  readonly checked: boolean;
  /** 目录校验不通过（ADR 0041 第 4 节） */
  readonly configError: boolean;
  /** 当前视图里至少有一张瓦片加载失败（ADR 0041 第 5 节） */
  readonly tileError: boolean;
  readonly minzoom: number | undefined;
  /** 当前的缩放级别 */
  readonly zoom: number;
}

/**
 * 资源在列表上的提示：配置错误时只提示它（不会显示）；勾选了但当前级别还不显示时说明放大到几级，
 * 免得被当成加载失败；瓦片加载失败说的是部分失败，不是整个资源不可用
 */
export function resourceNotices({ checked, configError, tileError, minzoom, zoom }: ResourceNoticeInput): string[] {
  if (configError) {
    return ['配置错误，不显示'];
  }
  const notices: string[] = [];
  if (checked && minzoom !== undefined && zoom < minzoom) {
    notices.push(`放大至第 ${minzoom} 级显示`);
  }
  if (tileError) {
    notices.push('部分瓦片加载失败');
  }
  return notices;
}
