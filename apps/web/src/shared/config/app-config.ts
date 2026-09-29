function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请检查 apps/web 下的 .env 文件`);
  }
  return value;
}

// 未压缩格式的 SM2 公钥：04 加上 x、y 坐标各 64 位十六进制
const SM2_PUBLIC_KEY_PATTERN = /^04[0-9a-f]{128}$/i;

function sm2PublicKey(name: string, value: string | undefined): string {
  const key = required(name, value);
  if (!SM2_PUBLIC_KEY_PATTERN.test(key)) {
    throw new Error(`环境变量 ${name} 不是有效的 SM2 公钥（应为 04 开头的 130 位十六进制）`);
  }
  return key;
}

/** 校验过的应用配置；自定义环境变量只在这里读取 */
export const appConfig = {
  /** 系统名称 */
  title: required('VITE_APP_TITLE', import.meta.env.VITE_APP_TITLE),
  /** 接口基础地址 */
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  /** 登录密码加密用的 SM2 公钥 */
  loginPublicKey: sm2PublicKey('VITE_LOGIN_PUBLIC_KEY', import.meta.env.VITE_LOGIN_PUBLIC_KEY)
} as const;
