// Vue 的 TSX 类型尚未声明标准 Popover 属性，仅补充浏览器已有的类型
// moduleDetection: force 使本文件扩充模块，使用 .ts 保证声明本身参与类型检查
declare module 'vue' {
  interface HTMLAttributes {
    popover?: 'auto' | 'manual' | 'hint';
  }

  interface ButtonHTMLAttributes {
    popovertarget?: string;
  }
}
