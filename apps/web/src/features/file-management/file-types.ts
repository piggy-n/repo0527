import type { FileRecord } from './api';

export { formatFileBytes } from '@/shared/file-transfer/file-size';

/** 传输只需要文件身份和取流参数，不复制整行业务数据 */
export type FileTransferTarget = Pick<FileRecord, 'id' | 'name' | 'type' | 'objectKey'>;
export type FilePreviewKind = 'docx' | 'pdf' | 'text' | 'image';

// 仅预览已确认的文档和图片格式，不扩展可执行文档类型
const types: Readonly<Record<string, { kind: FilePreviewKind; mime: string }>> = {
  docx: { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  txt: { kind: 'text', mime: 'text/plain' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  bmp: { kind: 'image', mime: 'image/bmp' }
};

/** 只接收接口约定的扩展名；未知格式仍允许下载 */
export function filePreviewType(type: string) {
  const extension = type.toLowerCase();
  return Object.hasOwn(types, extension) ? types[extension] : undefined;
}
