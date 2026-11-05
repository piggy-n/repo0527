import { HttpResponse } from 'msw';

/** 一次回答的结果，结构取自旧项目 views/ai-chat/data.json 的第一条（数据删减） */
export function chatResultBody(overrides: Record<string, unknown> = {}) {
  return {
    answer: '江苏省2022年农用地分类统计结果如下',
    geojson: null,
    mvt_params: { table: 'bgdc_dltb_2022', filter_id: '0e380c6090e8', admin_name: '全表', tag: '统计' },
    mvt_params_list: null,
    mvt_group: null,
    change_mvt_params: null,
    layer_tag: '统计',
    chart: {
      title: '全表 DLBM 分类统计',
      x_axis: ['0101 水田', '0102 水浇地'],
      y_axis: [42658273.89, 12835190.64],
      type: 'bar',
      y_label: '面积(亩)'
    },
    table_data: {
      columns: ['编码', '名称', '面积(亩)'],
      rows: [
        { 编码: '0101', 名称: '水田', '面积(亩)': 42658273.89 },
        { 编码: '0102', 名称: '水浇地', '面积(亩)': 12835190.64 }
      ]
    },
    excel_url: '/api/exports/download/breakdown_全表_bgdc_dltb_2022_0670b837.xlsx',
    duration_ms: 964931,
    token_count: 981,
    tps: 1.0,
    steps: [
      {
        tool: 'spatial_breakdown',
        input: { admin_name: '', group_field: 'DLBM', table_name: 'DLTB_2022' },
        status: 'done',
        output: 'content=\'{"success": true, "table": "bgdc_dltb_2022", "groups": [{"val'
      }
    ],
    ...overrides
  };
}

/** SSE 的一行 */
export const sseLine = (event: unknown) => `data: ${JSON.stringify(event)}\n`;

/** 按给定的分块推送的 SSE 响应；hold 为 true 时推完不结束，模拟还在回答 */
export function sseResponse(chunks: readonly string[], { hold = false } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (!hold) {
        controller.close();
      }
    }
  });
  return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
