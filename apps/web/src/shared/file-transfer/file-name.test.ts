// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { downloadFileName } from './file-name';

describe('下载文件名', () => {
  it('UTF-8 扩展名称优先于普通名称，保留中文与扩展名', () => {
    expect(downloadFileName("attachment; filename=report.pdf; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf", '后备.pdf'))
      .toBe('报告.pdf');
    expect(downloadFileName("attachment; FILENAME*=utf-8'zh'%E6%8A%A5%E5%91%8A.pdf; filename=report.pdf", '后备.pdf'))
      .toBe('报告.pdf');
  });

  it('无效扩展编码或不支持的字符集回退到普通名称', () => {
    expect(downloadFileName("attachment; filename*=UTF-8''%E6%; filename=ok.pdf", '后备.pdf')).toBe('ok.pdf');
    expect(downloadFileName("attachment; filename*=GBK''abc; filename=ok.pdf", '后备.pdf')).toBe('ok.pdf');
  });

  it('解析引号内的分号、转义引号，普通名称不进行 URL 解码', () => {
    expect(downloadFileName('attachment; filename="报告;附件.pdf"', '后备')).toBe('报告;附件.pdf');
    expect(downloadFileName('attachment; filename="报告\\"附件.txt"', '后备')).toBe('报告附件.txt');
    expect(downloadFileName('attachment; filename="100%20.txt"', '后备')).toBe('100%20.txt');
  });

  it('清除路径、控制字符和设备名，清理后为空时依次回退', () => {
    expect(downloadFileName('attachment; filename="../../报告.txt"', '后备')).toBe('报告.txt');
    expect(downloadFileName(null, 'C:\\目录\\报告\n?.txt')).toBe('报告.txt');
    expect(downloadFileName(null, 'CON.txt')).toBe('_CON.txt');
    expect(downloadFileName('attachment; filename=".."', '后备.txt')).toBe('后备.txt');
    expect(downloadFileName(null, '..')).toBe('文件');
  });

  it('没有文件名的头部使用业务名称，不重复扩展名', () => {
    expect(downloadFileName(null, '完整名称.pdf')).toBe('完整名称.pdf');
    expect(downloadFileName('inline', '完整名称.pdf')).toBe('完整名称.pdf');
  });
});
