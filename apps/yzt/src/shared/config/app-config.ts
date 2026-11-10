function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请检查 apps/yzt 下的 .env 文件`);
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

/** 三维引擎（ADR 0147）：cesium 是现有的 Cesium，maplibre 是 MapLibre + Three.js，二三维共用一块画布 */
export type Map3dEngine = 'cesium' | 'maplibre';

const MAP_3D_ENGINES: readonly Map3dEngine[] = ['cesium', 'maplibre'];

function map3dEngine(value: string | undefined): Map3dEngine {
  const text = required('VITE_MAP_3D_ENGINE', value);
  const engine = MAP_3D_ENGINES.find(item => item === text);
  if (!engine) {
    throw new Error(`环境变量 VITE_MAP_3D_ENGINE 只能是 ${MAP_3D_ENGINES.join(' 或 ')}，当前是 "${text}"`);
  }
  return engine;
}

// 开关和 key 合成一个值：关闭时不读 key，开启时 key 必须有效（ADR 0031）
function tianditu(enabled: string | undefined, key: string | undefined): TiandituConfig | null {
  if (!flag('VITE_TIANDITU_ENABLED', enabled)) {
    return null;
  }
  return { key: matching('VITE_TIANDITU_KEY', key, TIANDITU_KEY_PATTERN, '不是有效的天地图 key（应为 32 位十六进制）') };
}

// 总开关和分项开关都为 true 才生效；总开关关闭时分项开关照样校验，拼错了不等到打开时才发现（ADR 0140）
function preferenceSwitches() {
  const enabled = flag('VITE_PREFERENCES_ENABLED', import.meta.env.VITE_PREFERENCES_ENABLED);
  const item = (name: string, value: string | undefined) => {
    const on = flag(name, value);
    return enabled && on;
  };
  return {
    basemap: item('VITE_PREFERENCE_BASEMAP', import.meta.env.VITE_PREFERENCE_BASEMAP),
    'basemap-labels': item('VITE_PREFERENCE_BASEMAP_LABELS', import.meta.env.VITE_PREFERENCE_BASEMAP_LABELS),
    boundaries: item('VITE_PREFERENCE_BOUNDARIES', import.meta.env.VITE_PREFERENCE_BOUNDARIES),
    'resource-layers': item('VITE_PREFERENCE_RESOURCE_LAYERS', import.meta.env.VITE_PREFERENCE_RESOURCE_LAYERS),
    'resource-symbols': item('VITE_PREFERENCE_RESOURCE_SYMBOLS', import.meta.env.VITE_PREFERENCE_RESOURCE_SYMBOLS),
    'resource-panel': item('VITE_PREFERENCE_RESOURCE_PANEL', import.meta.env.VITE_PREFERENCE_RESOURCE_PANEL)
  };
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
  tianditu: tianditu(import.meta.env.VITE_TIANDITU_ENABLED, import.meta.env.VITE_TIANDITU_KEY),
  /** AI 对话后端的基础地址，与 apiBaseUrl 是两个服务 */
  aiApiBaseUrl: required('VITE_AI_API_BASE_URL', import.meta.env.VITE_AI_API_BASE_URL),
  /** 离开页面后重置：为 true 时不缓存页面，每次进入都是初始状态（ADR 0114）；不影响偏好（ADR 0140） */
  pageStateReset: flag('VITE_PAGE_STATE_RESET', import.meta.env.VITE_PAGE_STATE_RESET),
  /** 各项偏好是否生效，已经合并了总开关；为 false 的不读不写（ADR 0140） */
  preferences: preferenceSwitches(),
  /** 资源的最小显示级别：为 false 时不限制，各级都请求瓦片（ADR 0132） */
  resourceMinZoomEnabled: flag('VITE_RESOURCE_MIN_ZOOM_ENABLED', import.meta.env.VITE_RESOURCE_MIN_ZOOM_ENABLED),
  /** 三维引擎（ADR 0147）：换引擎要重新构建，页面和拥有者不判断它，由 app 注入地图 */
  map3dEngine: map3dEngine(import.meta.env.VITE_MAP_3D_ENGINE)
} as const;

/** 偏好的名称：新增偏好先在 preferenceSwitches 登记开关，否则 usePreference 的 name 通不过类型检查 */
export type PreferenceName = keyof typeof appConfig.preferences;
