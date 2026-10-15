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
 * 一条提示：最小显示级别只是说明，面板收进名称后的信息图标；配置错误、瓦片加载失败要处理，直接显示（ADR 0053 第 6 节）
 */
export interface ResourceNotice {
  readonly kind: 'config-error' | 'minzoom' | 'tile-error';
  readonly text: string;
}

/**
 * 资源在列表上的提示：配置错误时只提示它（不会显示）；勾选了但当前级别还不显示时说明放大到几级，
 * 免得被当成加载失败；瓦片加载失败说的是部分失败，不是整个资源不可用
 */
export function resourceNotices({ checked, configError, tileError, minzoom, zoom }: ResourceNoticeInput): ResourceNotice[] {
  if (configError) {
    return [{ kind: 'config-error', text: '配置错误，不显示' }];
  }
  const notices: ResourceNotice[] = [];
  if (checked && minzoom !== undefined && zoom < minzoom) {
    notices.push({ kind: 'minzoom', text: `放大至第 ${minzoom} 级显示` });
  }
  if (tileError) {
    notices.push({ kind: 'tile-error', text: '部分瓦片加载失败' });
  }
  return notices;
}
