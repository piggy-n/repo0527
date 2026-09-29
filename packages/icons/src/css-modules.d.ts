// 包不加载 vite/client 类型（避免读取 import.meta.env），CSS Modules 的类型在这里声明
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
