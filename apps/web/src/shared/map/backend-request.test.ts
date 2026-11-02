import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../auth/roles';
import { useSessionStore } from '../auth/session-store';
import { configureHttp, type HttpHooks } from '../http/configure';
import { UNAUTHORIZED_MESSAGE } from '../http/messages';
import { backendTransformRequest, JIANGSU_MAP_OPTIONS, reportMapError } from './backend-request';
import { JIANGSU_ZOOM_RANGE } from './jiangsu';

const BACKEND = `${window.location.origin}/backend/`;
const TILE = `${BACKEND}api/tiles/a/1/1/1.pbf`;
const TIANDITU = 'https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile';

function signIn(token: string): void {
  useSessionStore().start({ token, user: { loginName: 'tester', role: Role.user } });
}

// 和 MapLibre 的 AJAXError 一样，是带状态码和地址的 Error 子类
class TileError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`AJAXError: ${status}: ${url}`);
    this.status = status;
    this.url = url;
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  useSessionStore().clear();
});

describe('backendTransformRequest', () => {
  it.each([
    `${BACKEND}api/tiles/bgdc_dltb_2022/5/26/13.pbf`,
    `${BACKEND}api/query/mvt?layerCode=a&z=5&x=26&y=13`,
    `${BACKEND}api/analysis/mvt/1/a/5/26/13.pbf`
  ])('发往后端的请求带 token：%s', url => {
    signIn('abc');
    expect(backendTransformRequest(url)).toEqual({ url, headers: { token: 'abc' } });
  });

  it.each([
    TIANDITU,
    'https://other.example/backend/api/tiles/a/1/1/1.pbf',
    `${window.location.origin}/fonts/glyphs/a/0-255.pbf`,
    `${window.location.origin}/backend-other/a.pbf`
  ])('其他地址不带 token：%s', url => {
    signIn('abc');
    expect(backendTransformRequest(url)).toEqual({ url });
  });

  it('每次请求都读取当前的 token：重新登录后用新的，退出后不带', () => {
    signIn('first');
    expect(backendTransformRequest(TILE)).toEqual({ url: TILE, headers: { token: 'first' } });

    signIn('second');
    expect(backendTransformRequest(TILE)).toEqual({ url: TILE, headers: { token: 'second' } });

    useSessionStore().clear();
    expect(backendTransformRequest(TILE)).toEqual({ url: TILE });
  });

  it('画布选项包含缩放范围和这个转换函数', () => {
    expect(JIANGSU_MAP_OPTIONS).toEqual({ ...JIANGSU_ZOOM_RANGE, transformRequest: backendTransformRequest });
  });
});

describe('reportMapError', () => {
  const onUnauthorized = vi.fn<NonNullable<HttpHooks['onUnauthorized']>>();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    onUnauthorized.mockClear();
    consoleError.mockClear();
    configureHttp({ onUnauthorized });
  });

  afterEach(() => {
    configureHttp({});
  });

  it('带 token 发往后端的瓦片返回 401：交给 onUnauthorized，不打印', () => {
    signIn('abc');
    backendTransformRequest(TILE);

    reportMapError(new TileError(401, TILE));

    expect(onUnauthorized).toHaveBeenCalledOnce();
    const [error, sent] = onUnauthorized.mock.calls[0] ?? [];
    expect(error).toMatchObject({ kind: 'unauthorized', status: 401, url: TILE, message: UNAUTHORIZED_MESSAGE });
    expect(sent).toEqual({ headers: { token: 'abc' } });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('交出的是发出瓦片时的 token：之后换了会话，由 onUnauthorized 分辨出是旧会话的请求', () => {
    signIn('first');
    backendTransformRequest(TILE);
    signIn('second');

    reportMapError(new TileError(401, TILE));

    expect(onUnauthorized.mock.calls[0]?.[1]).toEqual({ headers: { token: 'first' } });
  });

  it('没带 token 发出的瓦片返回 401：不算登录过期', () => {
    backendTransformRequest(TILE);

    reportMapError(new TileError(401, TILE));

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it.each([
    ['第三方地址的 401', new TileError(401, TIANDITU)],
    ['后端瓦片的其他状态码', new TileError(500, TILE)],
    ['没有状态码的错误', new Error('样式不合法')]
  ])('%s：只打印到控制台', (_name, error) => {
    signIn('abc');
    backendTransformRequest(TILE);

    reportMapError(error);

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[map]', error);
  });
});
