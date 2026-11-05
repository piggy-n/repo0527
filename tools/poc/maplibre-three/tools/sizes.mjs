// 构建后统计每个分块压缩前后的大小
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join } from 'node:path';
const dir = process.argv[2];
const rows = [];
for (const name of readdirSync(dir)) {
  const file = join(dir, name);
  if (!statSync(file).isFile() || !/\.(js|mjs|css)$/.test(name)) continue;
  const data = readFileSync(file);
  rows.push({ name, raw: data.length, gzip: gzipSync(data).length, brotli: brotliCompressSync(data).length });
}
rows.sort((a, b) => b.raw - a.raw);
let sum = { raw: 0, gzip: 0, brotli: 0 };
for (const row of rows) {
  sum.raw += row.raw; sum.gzip += row.gzip; sum.brotli += row.brotli;
  console.log(row.name.padEnd(60), (row.raw / 1024).toFixed(1).padStart(10), (row.gzip / 1024).toFixed(1).padStart(10), (row.brotli / 1024).toFixed(1).padStart(10));
}
console.log('TOTAL'.padEnd(60), (sum.raw / 1024).toFixed(1).padStart(10), (sum.gzip / 1024).toFixed(1).padStart(10), (sum.brotli / 1024).toFixed(1).padStart(10));
