function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请检查 apps/web 下的 .env 文件`);
  }
  return value;
}

function matching(name: string, value: string | undefined, pattern: RegExp, problem: string): string {
  const text = required(name, value);
  if (!pattern.test(text)) {
    throw new Error(`环境变量 ${name} ${problem}`);
  }
  return text;
}

// 只接受小写的 true、false，拼错时报错，不按"非空即真"处理
function flag(name: string, value: string | undefined): boolean {
  const text = required(name, value);
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  throw new Error(`环境变量 ${name} 只能是 true 或 false，当前是 "${text}"`);
}

// 未压缩格式的 SM2 公钥：04 加上 x、y 坐标各 64 位十六进制
const SM2_PUBLIC_KEY_PATTERN = /^04[0-9a-f]{128}$/i;
const TIANDITU_KEY_PATTERN = /^[0-9a-f]{32}$/i;

/** 天地图的配置；关闭天地图（内网部署）时 appConfig.tianditu 为 null */
export interface TiandituConfig {
  /** 浏览器端 key，会写在每个瓦片地址里 */
  readonly key: string;
}

// 开关和 key 合成一个值：关闭时不读 key，开启时 key 必须有效（ADR 0031）
function tianditu(enabled: string | undefined, key: string | undefined): TiandituConfig | null {
  if (!flag('VITE_TIANDITU_ENABLED', enabled)) {
    return null;
  }
  return { key: matching('VITE_TIANDITU_KEY', key, TIANDITU_KEY_PATTERN, '不是有效的天地图 key（应为 32 位十六进制）') };
}

/** 校验过的应用配置；自定义环境变量只在这里读取 */
export const appConfig = {
  /** 系统名称 */
  title: required('VITE_APP_TITLE', import.meta.env.VITE_APP_TITLE),
  /** 接口基础地址 */
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  /** 登录密码加密用的 SM2 公钥 */
  loginPublicKey: matching(
    'VITE_LOGIN_PUBLIC_KEY',
    import.meta.env.VITE_LOGIN_PUBLIC_KEY,
    SM2_PUBLIC_KEY_PATTERN,
    '不是有效的 SM2 公钥（应为 04 开头的 130 位十六进制）'
  ),
  /** 天地图；为 null 时不能向天地图发任何请求 */
  tianditu: tianditu(import.meta.env.VITE_TIANDITU_ENABLED, import.meta.env.VITE_TIANDITU_KEY)
} as const;
