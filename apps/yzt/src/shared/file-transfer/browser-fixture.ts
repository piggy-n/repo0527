import { z } from 'zod';
import { fetchFile, saveFile } from './index';
import { http, type TransferProgress } from '../http/client';
import { configureHttp } from '../http/configure';
import { ApiError } from '../http/errors';

const uploadResult = z.object({
  fields: z.array(z.object({ key: z.string(), name: z.string().nullable(), content: z.string() })),
  token: z.string(),
  contentType: z.string()
});

/** 在真实浏览器中生成 multipart，服务端按标准 FormData 解析 */
export async function upload(single: boolean) {
  configureHttp({ getHeaders: () => ({ token: 'transfer-test' }) });
  const body = new FormData();
  body.append(single ? 'file' : 'files', new File(['文档甲'], single ? '属性规范.xlsx' : '甲.txt'));
  if (!single) {
    body.append('files', new File(['文档乙'], '乙.txt'));
    body.append('categoryId', 'technical-standard-current-survey');
    body.append('tag', '综合');
  }
  body.append('year', '2026');
  const progress: TransferProgress[] = [];
  const result = await http.post('/transfer-test/upload', body, {
    schema: uploadResult,
    onUploadProgress: value => progress.push(value)
  });
  return { result, progress };
}

/** 接收不可作为 UTF-8 解码的文件，并交给浏览器下载 */
export async function download() {
  const progress: TransferProgress[] = [];
  const file = await fetchFile('/transfer-test/binary', {
    fallbackName: '后备.pdf',
    fallbackType: 'application/pdf',
    onDownloadProgress: value => progress.push(value)
  });
  saveFile(file);
  return { progress, type: file.blob.type, bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())) };
}

/** 未知总量时只汇报字节，首次收到内容后中止接收 */
export async function cancelDownload() {
  const controller = new AbortController();
  const progress: TransferProgress[] = [];
  const errors: string[] = [];
  configureHttp({ onError: error => errors.push(error.kind), onUnauthorized: error => errors.push(error.kind) });
  try {
    await http.getBlob('/transfer-test/chunks', {
      signal: controller.signal,
      onDownloadProgress: value => {
        progress.push(value);
        controller.abort();
      }
    });
    return { kind: 'unexpected-success', progress, errors };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    return { kind: error.kind, progress, errors };
  }
}

export { saveFile };
