import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createTitleOutline } from './outline.ts';

/** 一段要生成轮廓的文字 */
export interface OutlineSpec {
  text: string;
  /** 字间距，以 em 为单位，默认 0 */
  letterSpacing?: number;
  outputPath: string;
}

export interface SyncOptions extends OutlineSpec {
  fontPath: string;
}

export type SyncResult = 'generated' | 'unchanged' | 'font-missing';

/** 已生成的轮廓对应的文字与字间距；文件不存在或格式不对时返回 undefined */
export function readOutlineSpec(outputPath: string): { text: string; letterSpacing: number } | undefined {
  if (!existsSync(outputPath)) {
    return undefined;
  }
  const content: unknown = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (typeof content !== 'object' || content === null || !('text' in content) || typeof content.text !== 'string') {
    return undefined;
  }
  const letterSpacing = 'letterSpacing' in content && typeof content.letterSpacing === 'number' ? content.letterSpacing : 0;
  return { text: content.text, letterSpacing };
}

/** 文字或字间距与已生成的轮廓不一致时重新生成；缺少字体文件时不报错，沿用已提交的轮廓 */
export function syncTitleOutline({ text, letterSpacing = 0, fontPath, outputPath }: SyncOptions): SyncResult {
  const current = readOutlineSpec(outputPath);
  if (current?.text === text && current.letterSpacing === letterSpacing) {
    return 'unchanged';
  }
  if (!existsSync(fontPath)) {
    return 'font-missing';
  }
  const fontData = Uint8Array.from(readFileSync(fontPath)).buffer;
  // text、letterSpacing 供检查测试比对配置，font 记录生成所用的字体文件；字间距为 0 时不写，保持文件简洁
  const outline = {
    text,
    ...(letterSpacing ? { letterSpacing } : {}),
    font: basename(fontPath),
    ...createTitleOutline(fontData, text, letterSpacing)
  };
  writeFileSync(outputPath, `${JSON.stringify(outline, null, 2)}\n`);
  return 'generated';
}
