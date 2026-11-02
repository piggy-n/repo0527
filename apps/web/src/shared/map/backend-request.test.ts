import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../auth/roles';
import { useSessionStore } from '../auth/session-store';
import { backendTransformRequest, JIANGSU_MAP_OPTIONS, withBackendToken } from './backend-request';
import { JIANGSU_ZOOM_RANGE } from './jiangsu';

const BACKEND = 'http://localhost:5173/backend/';

function signIn(token: string): void {
  useSessionStore().start({ token, user: { loginName: 'tester', role: Role.user } });
}

describe('withBackendToken', () => {
  it.each([
    `${BACKEND}api/tiles/bgdc_dltb_2022/5/26/13.pbf`,
    `${BACKEND}api/query/mvt?layerCode=a&z=5&x=26&y=13`,
    `${BACKEND}api/analysis/mvt/1/a/5/26/13.pbf`
  ])('发往后端的请求带 token：%s', url => {
    expect(withBackendToken(url, BACKEND, 'abc')).toEqual({ url, headers: { token: 'abc' } });
  });

  it.each([
    'https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile',
    'https://other.example/backend/api/tiles/a/1/1/1.pbf',
    'http://localhost:5173/fonts/glyphs/a/0-255.pbf',
    'http://localhost:5173/backend-other/a.pbf'
  ])('其他地址不带 token：%s', url => {
    expect(withBackendToken(url, BACKEND, 'abc')).toEqual({ url });
  });

  it('没有 token 时不加请求头', () => {
    const url = `${BACKEND}api/tiles/a/1/1/1.pbf`;
    expect(withBackendToken(url, BACKEND, undefined)).toEqual({ url });
  });
});

describe('backendTransformRequest', () => {
  const tile = `${window.location.origin}/backend/api/tiles/a/1/1/1.pbf`;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    useSessionStore().clear();
  });

  it('每次请求都读取当前的 token：重新登录后用新的，退出后不带', () => {
    signIn('first');
    expect(backendTransformRequest(tile)).toEqual({ url: tile, headers: { token: 'first' } });

    signIn('second');
    expect(backendTransformRequest(tile)).toEqual({ url: tile, headers: { token: 'second' } });

    useSessionStore().clear();
    expect(backendTransformRequest(tile)).toEqual({ url: tile });
  });

  it('按配置的后端地址判断，天地图不带 token', () => {
    signIn('first');
    const tianditu = 'https://t0.tianditu.gov.cn/vec_w/wmts';
    expect(backendTransformRequest(tianditu)).toEqual({ url: tianditu });
  });

  it('画布选项包含缩放范围和这个转换函数', () => {
    expect(JIANGSU_MAP_OPTIONS).toEqual({ ...JIANGSU_ZOOM_RANGE, transformRequest: backendTransformRequest });
  });
});
