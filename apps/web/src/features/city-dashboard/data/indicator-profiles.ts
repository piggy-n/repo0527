import type { Indicator } from '../model';

type Driver = keyof typeof CITY_DRIVERS;
type Pattern = 'steady' | 'coverage' | 'rail' | 'risk' | 'project' | 'distance' | 'cohort' | 'flow';

interface Profile {
  base: number;
  driver: Driver;
  spread: number;
  change: number;
  noise: number;
  pattern: Pattern;
}

// 参数依次为参考量级、城市特征、空间差异、年变化率、波动幅度、演变方式
// 所有参数均为演示假设，不代表真实城市排名、业务阈值或历史统计
function profile(
  base: number,
  driver: Driver,
  spread: number,
  change: number,
  noise: number,
  pattern: Pattern = 'steady'
): Profile {
  return { base, driver, spread, change, noise, pattern };
}

// 覆盖率采用有界增长，接近饱和的指标自然减速，不通过截断制造大量 100%
function coverage(base: number, driver: Driver, spread: number, change = 0.05, noise = 0.012): Profile {
  return profile(base, driver, spread, change, noise, 'coverage');
}

// 指标参数独立配置，避免相邻编码沿用同一量级、排序和年度曲线
export const INDICATOR_PROFILES: Readonly<Record<string, Profile>> = {
  // 安全韧性：救援逐步完善，避难空间差异较大，积水点呈稀疏事件分布
  'A-15': coverage(90, 'service', 0.09, 0.09, 0.018),
  'A-14': profile(1.85, 'green', 0.4, 0.04, 0.025, 'project'),
  'B-12': profile(6, 'size', 0.65, -0.07, 0.45, 'risk'),
  'B-11': coverage(44, 'green', 0.17, 0.025, 0.008),
  'D01-5': coverage(84, 'compact', 0.12, 0.065, 0.016),

  // 创新高效 / 开放繁荣：轨道与枢纽存在集聚，路网与距离使用不同量纲
  'B-57': profile(32, 'compact', 0.2, 0.07, 0.025, 'rail'),
  'A08-2': coverage(75, 'compact', 0.16, 0.055, 0.022),
  'B-35': coverage(98.2, 'access', 0.012, 0.16, 0.003),
  'B-19': profile(14, 'education', 1.05, 0.009, 0.003, 'project'),
  'A-20': profile(6.1, 'compact', 0.22, 0.022, 0.008),
  'B-47': coverage(72, 'access', 0.24, 0.08, 0.014),
  'A08-1': coverage(53, 'industry', 0.2, 0.085, 0.027),
  'B02-4': profile(0.025, 'education', 0.85, 0.003, 0.018),
  'B02-5': profile(0.045, 'industry', 0.45, -0.005, 0.018, 'cohort'),
  'B08-1': profile(2.5, 'green', 0.32, 0.014, 0.01),
  'B08-2': profile(1.35, 'industry', 0.48, 0.04, 0.025, 'project'),
  'F01-2': coverage(1.2, 'compact', 0.005, 0.065, 0.012),
  'F01-4': coverage(15.8, 'compact', 0.04, 0.02, 0.008),
  'F02-1': profile(780, 'access', 0.5, 0.035, 0.006, 'project'),
  'F02-2': profile(165, 'industry', 0.28, 0.013, 0.008),
  'F02-3': profile(4.9, 'access', 0.24, 0.018, 0.004, 'project'),
  'F02-4': profile(126, 'green', 0.34, 0.011, 0.008),
  'F02-5': coverage(2.3, 'access', 0.011, 0.04, 0.01),
  'F03-2': coverage(49, 'access', 0.21, 0.065, 0.019),
  'F03-4': coverage(61, 'welfare', 0.13, -0.025, 0.025),
  'F04-1': profile(3.8, 'green', 0.5, -0.016, 0.01, 'distance'),
  'F04-2': profile(2.3, 'green', 0.32, -0.008, 0.015, 'distance'),
  'F04-3': profile(8.2, 'green', 0.4, -0.018, 0.008, 'distance'),
  'F04-4': profile(14.5, 'green', 0.55, -0.035, 0.016, 'distance'),
  'F04-5': profile(10.5, 'size', 0.32, 0.007, 0.023, 'distance'),
  'F04-6': profile(48, 'green', 0.56, -0.006, 0.004, 'distance'),
  'F04-7': profile(37, 'inland', 0.95, -0.004, 0.004, 'distance'),

  // 共享幸福：基础服务渐趋饱和，教育受生源变化影响，养老与住房按不同节奏供给
  'A-31': coverage(78, 'service', 0.15, 0.085, 0.019),
  'A-32': coverage(65, 'education', 0.17, 0.035, 0.024),
  'A-33': coverage(57, 'compact', 0.14, 0.055, 0.015),
  'A-34': coverage(46, 'welfare', 0.22, 0.12, 0.038),
  'A-35': coverage(69, 'education', 0.16, 0.08, 0.025),
  'A-36': coverage(79, 'industry', 0.11, 0.065, 0.026),
  'B-58': profile(12.5, 'welfare', 0.27, -0.045, 0.025, 'cohort'),
  'B-14': coverage(67, 'service', 0.2, 0.065, 0.018),
  'B-59': profile(33, 'welfare', 0.5, 0.055, 0.04, 'project'),
  'B-34': coverage(91, 'access', 0.07, 0.09, 0.011),
  'A-37': coverage(48, 'green', 0.17, 0.13, 0.033),
  'A-13': profile(7.7, 'service', 0.24, 0.027, 0.018),
  'B-65': coverage(63, 'green', 0.21, 0.065, 0.018),
  'B-63': profile(3.6, 'education', 0.5, 0.022, 0.018, 'project'),
  'A-30': coverage(27, 'compact', 0.12, 0.11, 0.024),
  'B-61': profile(1.8, 'green', 0.45, 0.04, 0.025, 'project'),
  'A02-1': coverage(78, 'compact', 0.12, 0.018, 0.025),
  'A04-1': coverage(58, 'education', 0.21, 0.07, 0.018),
  'A06-5': coverage(41, 'welfare', 0.17, 0.1, 0.032),
  'A07-1-1': coverage(84, 'compact', 0.1, 0.04, 0.028),
  'A09-2': coverage(83, 'service', 0.1, 0.07, 0.013),
  'B02-1': profile(1.65, 'welfare', 0.3, -0.035, 0.018, 'cohort'),
  'B02-2': profile(0.72, 'green', 0.35, -0.013, 0.01, 'cohort'),
  'B02-3': profile(0.36, 'education', 0.28, 0.005, 0.012, 'cohort'),
  'B02-6': profile(8.5, 'education', 0.35, 0.012, 0.016),
  'B03-1': profile(0.42, 'service', 0.4, 0.014, 0.018),
  'B03-2': profile(1.7, 'welfare', 0.35, 0.023, 0.021),
  'B03-3': profile(2.8, 'service', 0.33, 0.032, 0.021, 'project'),
  'B03-4': profile(1.55, 'service', 0.3, 0.024, 0.016, 'project'),
  'B04-2': profile(2.9, 'welfare', 0.43, 0.033, 0.02),
  'B04-3': profile(0.8, 'education', 0.52, 0.021, 0.02, 'project'),
  'B05-1': profile(0.32, 'industry', 0.52, 0.04, 0.026, 'project'),
  'B06-1': profile(0.8, 'welfare', 0.43, 0.05, 0.032),
  'B06-2': profile(0.025, 'service', 0.38, 0.011, 0.012),
  'B06-3': profile(0.052, 'welfare', 0.55, 0.025, 0.02),
  'B06-4': profile(0.94, 'welfare', 0.37, 0.036, 0.02, 'project'),
  'B06-5': profile(0.63, 'welfare', 0.32, 0.044, 0.023, 'project'),
  'A02-4': coverage(93, 'education', 0.065, 0.11, 0.013),
  'A06-2': coverage(70, 'welfare', 0.19, 0.095, 0.028),
  'A06-3': coverage(36, 'service', 0.2, 0.055, 0.026),
  'A06-4': coverage(43, 'welfare', 0.16, 0.08, 0.029),
  'D02-7': profile(17, 'size', 0.48, 0.012, 0.28, 'flow'),
  'D02-8': profile(17500, 'size', 0.95, 0.04, 0.025, 'project'),
  'D02-9': coverage(29, 'welfare', 0.14, 0.045, 0.06),

  // 协调节约：存量低频变化，年度更新用地可起伏，高层数量呈明显长尾
  'A-39': profile(14.5, 'green', 0.23, 0.024, 0.012),
  'B-21': profile(5.2, 'size', 0.72, 0.018, 0.38, 'flow'),
  'E03-1': coverage(12.8, 'green', 0.044, 0.018, 0.006),
  'B-60': profile(5.6, 'green', 0.48, 0.005, 0.002),
  'B-29': coverage(29, 'compact', 0.055, 0.003, 0.004),
  'A-16': profile(15, 'size', 1.1, 0.06, 0.008, 'project'),
  'A-38': profile(42.5, 'green', 0.1, 0.011, 0.007),
  'B-28': profile(2.8, 'size', 0.73, 0.028, 0.006),
  'B07-2': profile(1.2, 'green', 0.5, 0.014, 0.018),
  'D02-1-1': coverage(25, 'compact', 0.048, -0.008, 0.005),
  'G01-6-2': profile(230, 'industry', 0.95, 0.045, 0.012, 'project'),
  'D02-1-2': coverage(46, 'industry', 0.075, 0.012, 0.009),
  'D02-1-3': coverage(39, 'compact', 0.067, -0.003, 0.011),
  'D02-3-1': profile(4, 'size', 1.15, 0.055, 0.006, 'project'),
  'D02-3-2': profile(11, 'industry', 1.3, 0.045, 0.004, 'project'),
  'G01-6': profile(1100, 'size', 0.9, 0.04, 0.01, 'project'),
  'G01-6-1': profile(880, 'size', 0.85, 0.045, 0.012, 'project'),
  'A01-1': coverage(31, 'compact', 0.057, 0.004, 0.006),
  'D02-5': coverage(43, 'green', 0.068, -0.003, 0.005),
  'D02-6': profile(1.5, 'industry', 0.24, -0.008, 0.018)
};

// 城市特征用于模拟不同资源禀赋，顺序与城市编码对应，不能解读为真实测评得分
const CITY_CODES = [
  '320100',
  '320200',
  '320300',
  '320400',
  '320500',
  '320600',
  '320700',
  '320800',
  '320900',
  '321000',
  '321100',
  '321200',
  '321300'
];
const CITY_DRIVERS = {
  size: [0.7, 0.3, 0.65, -0.05, 1, 0.35, -0.3, -0.45, 0.4, -0.25, -0.65, -0.35, -0.5],
  compact: [0.6, 0.85, -0.25, 0.65, 0.75, 0.1, -0.15, -0.35, -0.8, -0.1, 0.35, 0, -0.45],
  service: [0.95, 0.4, 0.65, 0.15, 0.5, 0.2, -0.5, 0.05, -0.35, 0.3, 0.1, -0.15, -0.65],
  education: [1, 0.15, 0.65, -0.05, 0.5, 0, -0.45, 0.25, -0.3, 0.55, 0.4, -0.5, -0.8],
  green: [-0.4, -0.15, 0.5, -0.3, -0.6, 0.4, 0.75, 0.3, 1, 0.65, 0.05, 0.25, 0.8],
  access: [0.9, 0.55, 0.8, 0.65, 0.2, -0.1, -0.4, -0.3, -0.6, 0.1, 0.45, 0, -0.65],
  industry: [0.2, 0.8, 0.15, 0.65, 1, 0.3, -0.1, -0.5, 0, -0.15, 0.35, 0.55, -0.35],
  welfare: [-0.2, 0.5, 0, -0.1, 0.2, 0.85, -0.4, 0.6, 0.55, 0.9, 0.1, 0.65, -0.25],
  inland: [0.1, 0.2, 0.95, 0.05, -0.25, -0.75, -1, 0.65, -0.65, 0.45, -0.1, -0.2, 0.85]
};

// 混合散列打散相邻城市与指标编码的相关性，固定年份下刷新仍得到同一组数据
function randomFor(key: string): number {
  let hash = 2166136261;
  for (const character of key) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

// 各城市拥有独立的项目节奏、生源拐点和短期扰动，不套用同一正弦曲线
export function createProfileValue(cityCode: string, indicator: Indicator, year: number): number {
  const settings = INDICATOR_PROFILES[indicator.id] || profile(indicator.mockBase, 'size', 0.3, 0.01, 0.04);
  const cityIndex = CITY_CODES.indexOf(cityCode);
  const driver = CITY_DRIVERS[settings.driver]?.[cityIndex] ?? 0;
  const key = `${indicator.id}:${cityCode}`;
  const random = (suffix: string) => randomFor(`${key}:${suffix}`);
  const spatial = driver + (random('level') - 0.5) * 1.3;
  const rate = settings.change * (0.4 + random('rate') * 1.2);
  // 固定 2025 为参数锚点，跨自然年后既有年份的 Mock 数值不漂移
  const offset = year - 2025;
  const noise = (random(`year:${year}`) - 0.5) * 1.2 + (random(`year:${year - 1}`) - 0.5) * 0.6;
  const disturbance = noise * settings.noise;
  const baseline = settings.base * Math.exp(spatial * settings.spread);
  let value;
  if (settings.pattern === 'coverage') {
    const level = Math.max(0.15, Math.min(99.7, settings.base + spatial * settings.spread * 100)) / 100;
    value = 100 / (1 + Math.exp(-(Math.log(level / (1 - level)) + offset * rate + disturbance)));
  } else if (settings.pattern === 'rail') {
    // 演示不同轨道发展阶段：部分城市尚未配置，已有城市按独立批次扩展
    const maturity = [1.65, 0.9, 0.55, 0.68, 1.5, 0.42, 0, 0, 0, 0, 0, 0, 0][cityIndex] || 0;
    const start = 2012 + Math.floor(random('opening') * 10);
    const stages = Math.max(
      0,
      Math.floor((year - start) / 2) + 1
    );
    value = maturity * settings.base * (1 - Math.exp(-stages * 0.28)) * (1 + disturbance);
  } else if (settings.pattern === 'risk') {
    // 积水点允许零值、局部集中与偶发回升，不强求各城市均匀分布
    const exposure = random('exposure');
    const event = random(`rain:${year}`);
    const surge = event > 0.85 ? 2.2 : 0.65 + event;
    value = exposure < 0.2 && event < 0.7 ? 0 : baseline * Math.exp(offset * rate) * (0.25 + exposure ** 2 * 1.8) * surge;
  } else if (settings.pattern === 'project' || settings.pattern === 'distance') {
    const period = 2 + Math.floor(random('period') * 3);
    const phase = Math.floor(random('phase') * period);
    const steps = Math.floor((year - 2010 + phase) / period) - Math.floor((2025 - 2010 + phase) / period);
    value = baseline * Math.exp(steps * period * rate + disturbance);
  } else if (settings.pattern === 'cohort') {
    const turningYear = 2019 + Math.floor(random('cohort') * 4);
    const trajectory = (at: number) => (Math.min(at, turningYear) - 2016) * 0.015 + Math.max(0, at - turningYear) * rate;
    value = baseline * Math.exp(trajectory(year) - trajectory(2025) + disturbance);
  } else if (settings.pattern === 'flow') {
    const cycle = Math.floor((year + Math.floor(random('phase') * 3)) / 3);
    const budget = (random(`budget:${cycle}`) - 0.5) * 0.8;
    value = baseline * Math.exp(offset * rate + noise * settings.noise * 2 + budget);
  } else {
    value = baseline * Math.exp(offset * rate + disturbance);
  }
  const upper = indicator.unit === '%' ? 100 : Infinity;
  return Number(Math.max(0, Math.min(upper, value)).toFixed(indicator.precision));
}
