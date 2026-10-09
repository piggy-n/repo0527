// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeMapStatus } from './map-status';

describe('describeMapStatus', () => {
  it('初始化中是加载中；没有视图、就绪、暂停、已释放时不显示', () => {
    expect(describeMapStatus('initializing', null)).toEqual({ kind: 'loading' });
    for (const state of ['idle', 'ready', 'paused', 'disposed'] as const) {
      expect(describeMapStatus(state, null)).toEqual({ kind: 'none' });
    }
  });

  it('不支持 WebGL2：说明原因和解决办法，可以重试', () => {
    const status = describeMapStatus('failed', { kind: 'engine', cause: 'webgl-unavailable', error: new Error('x') });

    expect(status).toMatchObject({ kind: 'engine-failed', title: '地图无法显示' });
    expect(status.kind === 'engine-failed' && status.detail).toContain('WebGL2');
  });

  it('引擎的其他错误：可以重试，技术细节单独给出', () => {
    const status = describeMapStatus('failed', { kind: 'engine', cause: 'unknown', error: new Error('setStyle failed') });

    expect(status).toMatchObject({ kind: 'engine-failed', title: '地图无法显示', technical: 'setStyle failed' });
  });

  it('样式失败：说明会自动恢复，不提供重试，技术细节单独给出', () => {
    const status = describeMapStatus('failed', {
      kind: 'style',
      error: new Error('layers.regions.paint.line-width: number expected')
    });

    expect(status).toEqual({
      kind: 'style-failed',
      title: '地图样式加载失败',
      detail: '部分图层的样式有误，地图暂时显示不了。改动图层后会自动重新加载。',
      technical: 'layers.regions.paint.line-width: number expected'
    });
  });

  it('处于 failed 却没有原因时按引擎失败处理；不是 Error 的原因转成文字', () => {
    expect(describeMapStatus('failed', null)).toMatchObject({ kind: 'engine-failed' });
    expect(describeMapStatus('failed', null)).not.toHaveProperty('technical');
    expect(describeMapStatus('failed', { kind: 'style', error: 'bad style' })).toMatchObject({ technical: 'bad style' });
  });
});
