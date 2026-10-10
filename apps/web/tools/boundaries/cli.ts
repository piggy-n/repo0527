import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOUNDARY_SOURCES } from './boundaries.ts';

// 转换行政区边界：在 apps/web 下运行 pnpm boundaries:generate <旧项目的 public/static/geojson 目录>（ADR 0033）
const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('[boundaries] 请给出旧项目 public/static/geojson 目录的路径，见 docs/modules/shared-map.md');
  process.exit(1);
}

const outputDir = resolve(process.cwd(), 'src/shared/map/boundary/data');
const kb = (text: string) => `${Math.round(Buffer.byteLength(text) / 1024)} KB`;
for (const { input, output, convert } of BOUNDARY_SOURCES) {
  const raw = readFileSync(resolve(sourceDir, input), 'utf8');
  const converted = JSON.stringify(convert(JSON.parse(raw)));
  writeFileSync(resolve(outputDir, output), converted);
  console.log(`[boundaries] ${input} → ${output}：${kb(raw)} → ${kb(converted)}`);
}
