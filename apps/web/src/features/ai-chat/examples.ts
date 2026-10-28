// 快捷提问，沿用旧项目
export const QUICK_EXAMPLES: readonly string[] = [
  '查看南京市的行政边界',
  '显示玄武区梅园新村街道的边界',
  '南京市有哪些区',
  '南京市2024年耕地有多少亩？',
  '江宁区湖熟街道的林地面积',
  '浦口区泰山街道建设用地面积',
  '南京市2024年各类用地分别有多少？',
  '栖霞区仙林街道有哪些耕地类型？',
  '按地类统计南京市2024年农用地面积',
  '南京市2019到2024年耕地面积变化',
  '对比南京市近两年建设用地变化趋势',
  '溧水区永阳街道耕地变化对比',
  '南京市各区耕地变化趋势',
  '按区统计南京市住宅用地面积',
  '南京市各区2019-2024年建设用地变化',
  '生成南京市2019-2024年土地流量表',
  '南京市耕地转建设用地有多少？',
  '高淳区淳溪街道的地类变更情况',
  '查询数据库中有哪些数据表',
  '查看dltb_2024表的字段结构'
];

/** 第一次显示的条数；之后每次换一批随机 3～5 条（沿用旧项目） */
export const INITIAL_EXAMPLE_COUNT = 4;

/** 换一批时的条数，3～5 条 */
export function nextExampleCount(random: () => number = Math.random): number {
  return 3 + Math.floor(random() * 3);
}

/** 随机挑 count 条不重复的快捷提问；random 返回 [0, 1)，测试时可以换成固定的序列 */
export function pickExamples(count: number, random: () => number = Math.random): string[] {
  const pool = [...QUICK_EXAMPLES];
  // 只洗前 count 个位置（Fisher–Yates）
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
