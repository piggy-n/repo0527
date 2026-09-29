import { defineComponent } from 'vue';
import styles from './icon.module.css';

/** 注册表中的一个图标，由规范化工具生成 */
export interface IconData {
  viewBox: string;
  /** 根元素上的展示属性，例如描边图标的 fill="none"、stroke="currentColor" */
  attrs?: Readonly<Record<string, string>>;
  /** <svg> 内部的标记 */
  body: string;
}

export type IconSet = Readonly<Record<string, IconData>>;

export interface IconProps<Name extends string> {
  name: Name;
  /** 数字按 px 处理；不传时为 1em，跟随字号 */
  size?: number | string;
  /** 不传时跟随父元素的 color */
  color?: string;
  /** 旋转角度，方向类图标可以复用 */
  rotate?: number;
  /** 传入后作为有意义的图片（role="img"），否则对读屏软件隐藏 */
  title?: string;
}

/** 用图标注册表创建图标组件；name 的类型是注册表的键，写错名字时类型检查报错 */
export function createIconComponent<Icons extends IconSet>(icons: Icons, componentName = 'SvgIcon') {
  // 函数签名写法：props 的类型由参数决定，适合泛型；运行时只需声明属性名
  return defineComponent(
    (props: IconProps<Extract<keyof Icons, string>>) => () => {
      const icon: IconData | undefined = icons[props.name];
      if (!icon) {
        console.warn(`[${componentName}] 找不到图标：${props.name}`);
        return null;
      }

      const size = typeof props.size === 'number' ? `${props.size}px` : props.size;
      return (
        <svg
          class={styles.icon}
          viewBox={icon.viewBox}
          fill="currentColor"
          {...icon.attrs}
          style={{
            width: size,
            height: size,
            color: props.color,
            transform: props.rotate ? `rotate(${props.rotate}deg)` : undefined
          }}
          role={props.title ? 'img' : undefined}
          aria-label={props.title}
          aria-hidden={props.title ? undefined : 'true'}
          // 内容来自规范化工具处理过的 SVG，脚本和事件属性已被移除
          innerHTML={icon.body}
        />
      );
    },
    { name: componentName, props: ['name', 'size', 'color', 'rotate', 'title'] }
  );
}
