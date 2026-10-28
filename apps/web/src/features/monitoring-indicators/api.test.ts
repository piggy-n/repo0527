import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { indicatorApi } from './api';
import type { IndicatorTreeNode } from './indicator-tree';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ok = (data: JsonBodyType) => HttpResponse.json({ success: true, code: 200, data, msg: '请求成功' });

// 下面的节点按 2026-10-28 实测的返回写（docs/migration.md）
const listLeaf = (dm: string, mc: string, change: Record<string, JsonBodyType> = {}) => ({
  result: '',
  reason: '',
  children: [],
  mc,
  sfjy: false,
  jb: null,
  bz: '城区',
  dm,
  status: '未处理',
  ...change
});

const listGroup = (dm: string, mc: string, children: JsonBodyType[], jb = 1) => ({
  children,
  mc,
  sfjy: 'false',
  jb,
  bz: null,
  dm,
  status: ''
});

// 综合分析指标的指标：sfjy 是字符串，没有状态、结果和原因
const zhLeaf = (dm: string, mc: string, sfjy: string) => ({
  children: [],
  mc,
  sfjy,
  jb: 3,
  bz: '城区',
  dm,
  status: ''
});

const outLeaf = (dm: string, mc: string, id: string, result: string) => ({
  bz: '城区',
  children: [],
  dm,
  id,
  jb: null,
  mc,
  result
});

const outGroup = (dm: string, mc: string, children: JsonBodyType[]) => ({
  bz: null,
  children,
  dm,
  id: '',
  jb: 1,
  mc,
  result: ''
});

const PARAMS = { category: 'cstjpg', regionCode: '320100', year: 2025 } as const;

describe('指标树', () => {
  it('计算树：按页签、范围、年份请求 /tree/list；状态、结果、原因按文字解析，空字符串是没有', async () => {
    const urls: URL[] = [];
    server.use(
      mock.get('/backend/api/analysis/tree/list', ({ request }) => {
        urls.push(new URL(request.url));
        return ok([
          listGroup('A', '教育便利性', [
            listLeaf('A-32', '社区小学步行10分钟覆盖率（%）', { status: '已完成', result: '40.04%' }),
            listLeaf('A-14', '人均应急避难场所面积（m²）', { status: '计算失败', reason: '缺少避难场所数据' }),
            listLeaf('B-19', '高等学校数量（所）', { bz: '全域' })
          ])
        ]);
      })
    );

    const nodes = await indicatorApi.fetchTree('calculation', PARAMS);

    expect(urls.map(url => Object.fromEntries(url.searchParams))).toEqual([
      { type: 'cstjpg', regionCode: '320100', year: '2025' }
    ]);
    expect(nodes).toEqual<IndicatorTreeNode[]>([
      {
        kind: 'group',
        code: 'A',
        name: '教育便利性',
        children: [
          {
            kind: 'leaf',
            code: 'A-32',
            dataId: null,
            name: '社区小学步行10分钟覆盖率（%）',
            disabled: false,
            status: 'done',
            result: '40.04%',
            reason: null
          },
          {
            kind: 'leaf',
            code: 'A-14',
            dataId: null,
            name: '人均应急避难场所面积（m²）',
            disabled: false,
            status: 'failed',
            result: null,
            reason: '缺少避难场所数据'
          },
          {
            kind: 'leaf',
            code: 'B-19',
            dataId: null,
            name: '高等学校数量（所）',
            disabled: false,
            status: 'pending',
            result: null,
            reason: null
          }
        ]
      }
    ]);
  });

  it('综合分析指标：字符串的 sfjy 按真假解析，没有状态时不显示标签；没有下级、没有统计范围的分类不显示', async () => {
    server.use(
      mock.get('/backend/api/analysis/tree/list', () =>
        ok([
          listGroup('C', '公共服务均衡普惠', [
            listGroup('C01', '教育设施普惠性', [zhLeaf('C01-1', '幼儿园覆盖率（%）', 'false')], 2),
            listGroup('C02', '福利设施普惠性', [], 2),
            listGroup('C03', '养老设施普惠性', [zhLeaf('C03-1', '养老床位数（张）', 'true')], 2)
          ])
        ])
      )
    );

    const nodes = await indicatorApi.fetchTree('calculation', { ...PARAMS, category: 'zhfxzb' });

    expect(nodes).toMatchObject([
      {
        code: 'C',
        children: [
          { code: 'C01', children: [{ kind: 'leaf', code: 'C01-1', disabled: false, status: null, result: null }] },
          { code: 'C03', children: [{ kind: 'leaf', code: 'C03-1', disabled: true }] }
        ]
      }
    ]);
  });

  it('展示树：请求 /tree/out，记录 ID 用来取成果；重复出现的分类去重，没有成果时 data 为 null', async () => {
    server.use(
      mock.get('/backend/api/analysis/tree/out', ({ request }) => {
        const year = new URL(request.url).searchParams.get('year');
        if (year === '2026') {
          return ok(null);
        }
        const education = outGroup('A', '教育便利性', [
          outLeaf('B-19', '高等学校数量（所）', '353b2061edd048eab4bbe184cce5c767', '123'),
          outLeaf('A-32', '社区小学步行10分钟覆盖率（%）', 'e3472ce215e0420baec22477cb48721b', '40.04%')
        ]);
        return ok([education, education]);
      })
    );

    const nodes = await indicatorApi.fetchTree('result', PARAMS);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      code: 'A',
      children: [
        { code: 'B-19', dataId: '353b2061edd048eab4bbe184cce5c767', result: '123', status: null, disabled: false },
        { code: 'A-32', dataId: 'e3472ce215e0420baec22477cb48721b', result: '40.04%' }
      ]
    });
    await expect(indicatorApi.fetchTree('result', { ...PARAMS, year: 2026 })).resolves.toEqual([]);
  });
});

describe('计算', () => {
  const params = { year: 2025, regionCode: '320100', analysisCode: 'A-32,A-33' };

  it('处理前验证提交条件，返回是否已有结果', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/api/analysis/verify', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, code: 200, data: true, msg: 'true为存在，false不存在。' });
      })
    );

    await expect(indicatorApi.verifyCalculation(params)).resolves.toBe(true);
    expect(bodies).toEqual([params]);
  });

  it('进度：结果去掉"分析结果:"前缀，ratio 到 100 算全部完成；还没有这次计算时是 null', async () => {
    const urls: URL[] = [];
    server.use(
      mock.get('/backend/api/analysis/progress', ({ request }) => {
        const url = new URL(request.url);
        urls.push(url);
        if (url.searchParams.get('year') === '2026') {
          return ok(null);
        }
        return ok({
          total: '一共2个指标',
          select: ['社区小学步行10分钟覆盖率（%）', '社区中学步行15分钟覆盖率（%）'],
          year: '2025年',
          calculate_data: [
            { code: 'A-32', name: '社区小学步行10分钟覆盖率（%）', result: '分析结果:40.04%' },
            { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）', result: '正在处理' }
          ],
          calculate: '2个指标，1个正在计算，1个已完成，0个计算失败',
          status: '正在处理',
          ratio: 50
        });
      })
    );

    await expect(indicatorApi.fetchProgress(params)).resolves.toEqual({
      rows: [
        { code: 'A-32', name: '社区小学步行10分钟覆盖率（%）', status: 'completed', result: '40.04%' },
        { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）', status: 'processing', result: null }
      ],
      percent: 50,
      finished: false,
      statusText: '正在处理'
    });
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      year: '2025',
      regionCode: '320100',
      analysisCode: 'A-32,A-33'
    });
    await expect(indicatorApi.fetchProgress({ ...params, year: 2026 })).resolves.toBeNull();
  });
});

describe('指标成果', () => {
  it('按记录 ID 请求；几何类型读 type，子图层排好顺序、配好颜色', async () => {
    const ids: (string | null)[] = [];
    server.use(
      mock.get('/backend/api/analysis/indicate', ({ request }) => {
        ids.push(new URL(request.url).searchParams.get('id'));
        return ok({
          id: '353b2061edd048eab4bbe184cce5c767',
          result: '123',
          layers: [
            { gdbName: 'xxp', chineseName: '学校点', type: 'POINT' },
            { gdbName: 'xzq', chineseName: '城市范围面', type: 'POLYGON' },
            { gdbName: 'xxa', chineseName: '学校面', type: 'POLYGON' },
            { gdbName: 'roads', chineseName: '路网', type: 'LINE' }
          ]
        });
      })
    );

    const result = await indicatorApi.fetchResult('353b2061edd048eab4bbe184cce5c767');

    expect(ids).toEqual(['353b2061edd048eab4bbe184cce5c767']);
    expect(result).toMatchObject({ analysisId: '353b2061edd048eab4bbe184cce5c767', value: '123' });
    expect(result.layers.map(({ key, name, geometry, range }) => [key, name, geometry, range])).toEqual([
      ['xxp', '学校点', 'point', false],
      ['roads', '路网', 'line', false],
      ['xxa', '学校面', 'fill', false],
      ['xzq', '城市范围面', 'fill', true]
    ]);
  });

  it('没见过的几何类型按返回格式错误处理', async () => {
    server.use(
      mock.get('/backend/api/analysis/indicate', () =>
        ok({ id: 'x', result: '1', layers: [{ gdbName: 'a', chineseName: '点', type: 'MULTIPOINT' }] })
      )
    );
    await expect(indicatorApi.fetchResult('x')).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
