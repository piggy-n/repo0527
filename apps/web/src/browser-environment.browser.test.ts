import { describe, expect, it } from 'vitest';

// 地图用例依赖 WebGL2：先单独检查，创建不了时给出诊断，不让后面的用例以难懂的方式失败（ADR 0040）
describe('浏览器测试的环境', () => {
  it('能创建 WebGL2，并输出渲染器', () => {
    const gl = document.createElement('canvas').getContext('webgl2');

    expect(gl, `创建不了 WebGL2，浏览器：${navigator.userAgent}`).not.toBeNull();
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = info
      ? gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl?.getParameter(WebGLRenderingContext.RENDERER);
    // oxlint-disable-next-line no-console -- 在 CI 日志里留下渲染器和浏览器版本，WebGL 出问题时据此诊断
    console.info(`[浏览器测试] WebGL2 渲染器：${String(renderer)}；浏览器：${navigator.userAgent}`);
  });
});
