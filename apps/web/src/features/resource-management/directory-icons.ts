import type { IconName } from '@/shared/icons/SvgIcon';
import type { ResourceDirectory } from './api';

// 旧目录图标的文件名不受目录重命名影响，优先按它映射；缺失时再按名称选择
const directoryIcons: Record<string, IconName> = {
  基础库: 'resource-base',
  公共库: 'resource-public',
  主题库: 'resource-topic',
  三区三线: 'map-boundaries',
  土地资源: 'resource-land',
  '地质/矿产资源': 'resource-geology',
  地质_矿产资源: 'resource-geology',
  海洋资源: 'resource-ocean',
  水资源: 'resource-water',
  森林资源: 'resource-forest',
  草原资源: 'resource-grass',
  湿地资源: 'resource-wetland',
  荒漠: 'resource-desert',
  国家公园: 'resource-park',
  气象: 'resource-weather',
  水利: 'resource-hydraulic',
  生态: 'resource-ecology',
  生态保护区: 'resource-ecology-protection',
  生态保护: 'resource-ecology-protection',
  耕地保护区: 'resource-protection',
  耕地保护: 'resource-protection',
  联合审批: 'resource-approval'
};

// 真实目录里湿地和国家公园共用一个旧图标文件名，按目录代码区分（代码不随改名变化）
const categoryIcons: Record<string, IconName> = { sdzy: 'resource-wetland', gjgyzy: 'resource-park' };

/** 目录的图标：不加载后端给的图标地址，已知的旧图标对应到本地图标，其他目录用默认图标 */
export function resourceDirectoryIcon(node: ResourceDirectory): IconName {
  const categoryIcon = node.code && categoryIcons[node.code];
  if (categoryIcon) {
    return categoryIcon;
  }
  for (const filename of [node.icon, node.iconSelected]) {
    const key = filename?.replace(/(?:1)?@1x\.png$/, '');
    if (key && directoryIcons[key]) {
      return directoryIcons[key];
    }
  }
  return directoryIcons[node.name] ?? 'resource-default';
}
