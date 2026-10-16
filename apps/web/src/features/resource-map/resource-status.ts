export interface ResourceStatusInput {
  readonly checked: boolean;
  /** 目录校验不通过（ADR 0041 第 4 节） */
  readonly configError: boolean;
  /** 当前视图里至少有一张瓦片加载失败（ADR 0041 第 5 节） */
  readonly tileError: boolean;
  readonly minzoom: number | undefined;
  /** 当前的缩放级别 */
  readonly zoom: number;
}

/** 严重程度的级别：错误（红色实心圆）、警告（橙色实心三角）、说明（灰色放大镜） */
export type ResourceStatusLevel = 'error' | 'warning' | 'info';

export interface ResourceStatus {
  readonly kind: 'config-error' | 'tile-error' | 'minzoom';
  readonly level: ResourceStatusLevel;
  readonly text: string;
}

/**
 * 资源在"已勾选"里的状态，按严重程度从高到低（ADR 0059）：列表只显示第一个的图标，提示列出全部，文字从简。
 * 配置错误时资源不画，只有它（原因由拥有者打印到控制台）；勾选了但级别不够时说明放大到几级，免得被当成加载失败；
 * 瓦片加载失败只知道至少有一张，不说"部分"
 */
export function resourceStatuses({ checked, configError, tileError, minzoom, zoom }: ResourceStatusInput): ResourceStatus[] {
  if (configError) {
    return [{ kind: 'config-error', level: 'error', text: '配置错误' }];
  }
  const statuses: ResourceStatus[] = [];
  if (tileError) {
    statuses.push({ kind: 'tile-error', level: 'warning', text: '有瓦片加载失败' });
  }
  if (checked && minzoom !== undefined && zoom < minzoom) {
    statuses.push({ kind: 'minzoom', level: 'info', text: `放大至第 ${minzoom} 级显示` });
  }
  return statuses;
}
