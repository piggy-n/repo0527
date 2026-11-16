import 'element-plus/dist/index.css';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { LayerPopover } from '@/shared/map/layer-panel/LayerPopover';
import { buildCatalog } from '../catalog';
import { useResourceSymbols } from '../composables/useResourceSymbols';
import { SymbolEditor } from './SymbolEditor';

// 真实的布局（ADR 0040）：档位和"自定义"是否同一行取决于字宽和浮层的宽度，jsdom 里量不出来

const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [{ code: 'csxhjctb_gyssp', name: '公用设施点层', geoType: 'Point', yearList: [2022] }]
  }
]);

// 用到的令牌由 app 的样式给出，这里直接写出；正文字体同 app（fonts.scss、base.scss），文件在不入库的 public/fonts/
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--font-size-xs': '12px',
  '--font-size-base': '14px',
  '--font-weight-semibold': '600',
  '--font-family-base': "'Alibaba PuHuiTi', 'Microsoft YaHei', sans-serif"
};
const STYLES = [
  `:root { ${Object.entries(TOKENS).map(([key, value]) => `${key}: ${value};`).join(' ')} }`,
  "@font-face { font-family: 'Alibaba PuHuiTi'; font-weight: 400; src: url('/fonts/AlibabaPuHuiTi-3-55-Regular.woff2'); }",
  "@font-face { font-family: 'Alibaba PuHuiTi'; font-weight: 600; src: url('/fonts/AlibabaPuHuiTi-3-75-SemiBold.woff2'); }",
  'body { font-family: var(--font-family-base); }',
  // 主题里 button-inline 的两条（测试不加载主题）：按钮不用浏览器默认的按钮字体，按下时半粗
  '.el-button.button-inline { font-family: var(--font-family-base); }',
  ".el-button.button-inline[aria-pressed='true'] { font-weight: var(--font-weight-semibold); }"
].join('\n');

/** 浮层的宽度：默认 300 贴在面板右边；sheet 时盖在面板下段上，宽度是面板宽减 16 */
interface PopoverOptions {
  readonly panelWidth: number;
  readonly width?: number;
  readonly sheet?: boolean;
}

// 一个面板和它右边的图例浮层，浮层里是点的符号编辑器
function setup({ panelWidth, width, sheet }: PopoverOptions) {
  const host = document.body.appendChild(document.createElement('div'));
  let panel: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  const Page = defineComponent(() => {
    const symbols = useResourceSymbols({ catalog: shallowRef(CATALOG) });
    return () => (
      <div>
        <div
          ref={(element: unknown) => (panel = element instanceof HTMLElement ? element : null)}
          style={{ width: `${panelWidth}px`, height: '600px', paddingTop: '160px', boxSizing: 'border-box' }}
        >
          <div ref={(element: unknown) => (list = element instanceof HTMLElement ? element : null)} style={{ height: '400px' }} />
        </div>
        <LayerPopover open panel={() => panel} list={() => list} anchor={() => list} width={width} sheet={sheet} label="图例">
          {{
            header: () => [h('span', '图例')],
            default: () => [<SymbolEditor symbols={symbols} target={{ code: 'csxhjctb_gyssp' }} name="公用设施点层" />]
          }}
        </LayerPopover>
      </div>
    );
  });
  const wrapper = mount(Page, { attachTo: host });
  return {
    wrapper,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 等字体、浮层放好以后的一帧
async function settle() {
  await document.fonts.ready;
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
}

// 大小一行：控件列宽，档位和"自定义"的中线差（两者高度不同，不比 top），这一行剩下的宽度，"自定义"在不在档位下面，
// 这一行和浮层的滚动区有没有横向溢出
function sizeRow(wrapper: VueWrapper) {
  const levels = wrapper.get('[data-size-levels]').element;
  const group = wrapper.get('[data-size-levels] [role="radiogroup"]').element.getBoundingClientRect();
  const custom = wrapper.get('[data-size-levels] button[aria-pressed]').element.getBoundingClientRect();
  const body = wrapper.get('[data-layer-popover]').element.lastElementChild;
  if (!(body instanceof HTMLElement)) {
    throw new Error('没有浮层的滚动区');
  }
  return {
    column: levels.clientWidth,
    middles: Math.abs(group.top + group.height / 2 - (custom.top + custom.height / 2)),
    room: levels.clientWidth - (custom.right - group.left),
    below: custom.top >= group.bottom && custom.left === group.left,
    overflow: [levels.scrollWidth - levels.clientWidth, body.scrollWidth - body.clientWidth]
  };
}

async function pressCustom(wrapper: VueWrapper) {
  await wrapper.get('[data-size-levels] button[aria-pressed]').trigger('click');
  await settle();
  expect(wrapper.get('[data-size-levels] button[aria-pressed]').attributes('aria-pressed')).toBe('true');
}

// 普惠体的文件在不在（不入库：CI、新的 worktree 里没有）
async function hasPuHuiTi(): Promise<boolean> {
  const faces = await document.fonts.load("12px 'Alibaba PuHuiTi'").catch(() => []);
  return faces.some(face => face.status === 'loaded');
}

describe('SymbolEditor 在图例浮层里（真实布局）', () => {
  const style = document.createElement('style');
  beforeAll(() => {
    style.textContent = STYLES;
    document.head.append(style);
  });
  afterAll(() => style.remove());

  // 按普惠体排：四档约 124、"自定义"约 41、间距 4，174 宽时还剩约 4。后备字体的字宽不同（CI 里没有这款字体，
  // 微软雅黑只剩约 1），没有字体文件时跳过。测试浏览器不显示滚动条：出现 6 宽的竖向滚动条时滚动区少 6，用 294 宽的浮层代替
  it.for([
    [300, 180],
    [294, 174]
  ] as const)(
    '%s 宽的图例浮层（控件列 %s）里四档和"自定义"同一行，至少留 2 像素；自定义时也是（用户 2026-11-15）',
    async ([width, column], { skip }) => {
      skip(!(await hasPuHuiTi()), '没有普惠体的字体文件');
      using ctx = setup({ panelWidth: 320, width });
      await settle();
      const shown = sizeRow(ctx.wrapper);
      expect(shown.column).toBe(column);
      expect(shown.middles).toBeLessThan(1);
      expect(shown.room).toBeGreaterThanOrEqual(2);
      expect(shown.overflow).toStrictEqual([0, 0]);

      // 自定义时"自定义"加粗、下面多一行输入框，仍同一行
      await pressCustom(ctx.wrapper);
      const pressed = sizeRow(ctx.wrapper);
      expect(pressed.middles).toBeLessThan(1);
      expect(pressed.room).toBeGreaterThanOrEqual(2);
      expect(pressed.overflow).toStrictEqual([0, 0]);
    }
  );

  it('手机宽度（294 宽的面板，浮层盖在下段上、控件列 158）："自定义"整个换到下一行，左边对齐档位，不横向溢出', async () => {
    using ctx = setup({ panelWidth: 294, sheet: true });
    await settle();
    const shown = sizeRow(ctx.wrapper);
    expect(shown.column).toBe(158);
    expect(shown.below).toBe(true);
    expect(shown.overflow).toStrictEqual([0, 0]);

    await pressCustom(ctx.wrapper);
    expect(sizeRow(ctx.wrapper).below).toBe(true);
    expect(sizeRow(ctx.wrapper).overflow).toStrictEqual([0, 0]);
  });
});
