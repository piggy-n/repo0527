import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createTitleOutline } from './outline.ts';

export interface SyncOptions {
  text: string;
  fontPath: string;
  outputPath: string;
}

export type SyncResult = 'generated' | 'unchanged' | 'font-missing';

function readOutputText(outputPath: string): string | undefined {
  if (!existsSync(outputPath)) {
    return undefined;
  }
  const content: unknown = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (typeof content === 'object' && content !== null && 'text' in content && typeof content.text === 'string') {
    return content.text;
  }
  return undefined;
}

/** 文字与已生成的轮廓不一致时重新生成；缺少字体文件时不报错，沿用已提交的轮廓 */
export function syncTitleOutline({ text, fontPath, outputPath }: SyncOptions): SyncResult {
  if (readOutputText(outputPath) === text) {
    return 'unchanged';
  }
  if (!existsSync(fontPath)) {
    return 'font-missing';
  }
  const fontData = Uint8Array.from(readFileSync(fontPath)).buffer;
  // text 供测试检查是否与 VITE_APP_TITLE 一致，font 记录生成所用的字体文件
  const outline = { text, font: basename(fontPath), ...createTitleOutline(fontData, text) };
  writeFileSync(outputPath, `${JSON.stringify(outline, null, 2)}\n`);
  return 'generated';
}
