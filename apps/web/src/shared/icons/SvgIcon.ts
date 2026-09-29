import { createIconComponent } from '@yzt/icons';
import icons from './icons.json';

/** 项目图标：名字对应 src/assets/icons 中的文件名，注册表由 @yzt/icons 自动生成（见 docs/modules/icons.md） */
export const SvgIcon = createIconComponent(icons, 'SvgIcon');

export type IconName = keyof typeof icons;

/** 全部图标名，供预览页等需要遍历的地方使用 */
export const iconNames = Object.keys(icons) as IconName[];
