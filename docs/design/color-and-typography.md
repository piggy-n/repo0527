# 系统配色与字体规范

> 本文收录用户提供的规范原文（2026-09-29），作为页面设计与实现的参考，内容不做改动。和 Element Plus 交互风格冲突时，优先和 Element 保持一致。
> 落地方式（完整令牌清单、与 Element Plus 的映射、使用规则）见 [theme.md](theme.md)。
> 第 5 节字体的落地与原文不同（ADR 0012）：正文改用普惠体 3.0 的 400、600 两个字重，系统名称用优设标题黑生成的 SVG 轮廓，不加载标题字体，也没有 `--font-family-title`；详见 [fonts.md](fonts.md)。

> 以系统「城市国土空间监测指标」页为例，色值与字号均取自现有实现。

## 1. 主题色 Primary

| 令牌 | 色值 | 用途 |
| --- | --- | --- |
| `primary` | `#597EF7` | **主色**。面板标题栏、选中态、勾选框、单选点、进度条、链接 |
| `primary-hover` | `#4F74F0` | 悬停 / 按下的加深态、蓝色状态文字 |
| `primary-border` | `#C9D4FB` | 常规描边（未选中的分段按钮、输入框） |
| `primary-border-hover` | `#9FB3FF` | 描边悬停 |
| `primary-bg` | `#EEF3FF` | 二级标题栏、分组底色 |
| `primary-bg-light` | `#F3F6FF` | 卡片浅底、图例标题栏 |
| `primary-bg-lighter` | `#FBFCFF` | 大面积极浅底 |

**透明度梯度**（叠加在浅色背景上，用于悬停、选中、滚动条）：

```
rgba(89,126,247, 0.05) 行选中底    0.12 悬停底    0.28 描边
rgba(89,126,247, 0.10) 标签底      0.14 标签底    0.32 滚动条滑块
```

---

## 2. 中性色 Neutral

### 文本

| 令牌 | 色值 | 用途 |
| --- | --- | --- |
| `text-title` | `#1F2937` | 页面 / 区块标题 |
| `text-strong` | `#2F3A4F` | 面板标题、强调文本 |
| `text-primary` | `#333333` | 正文（表格、表单主文本） |
| `text-regular` | `#4B5563` | 次级正文 |
| `text-secondary` | `#8A94A6` | 辅助说明、单位、状态文案 |
| `text-placeholder` | `#9AA5B8` | 占位符、空态提示 |
| `text-disabled` | `#C7CED9` | 禁用文本与图标 |

### 边框与分隔

| 令牌 | 色值 | 用途 |
| --- | --- | --- |
| `border-base` | `#E6EBF3` | 卡片、列表项描边 |
| `border-light` | `#EDF1F7` | 表格行分隔线 |
| `border-dashed` | `#E0E6F0` | 虚线分隔（子项区域） |
| `divider` | `#E2E5EC` | 分组之间的浅灰虚线 |

### 背景

| 令牌 | 色值 | 用途 |
| --- | --- | --- |
| `bg-page` | `#F5F7FB` | 页面底 |
| `bg-container` | `#FFFFFF` | 卡片 / 面板 |
| `bg-neutral` | `#EEF1F5` | 中性标签底 |
| `bg-neutral-light` | `#F1F4F8` | 中性标签底（浅） |
| `bg-mask` | `rgba(255,255,255,0.96)` | 浮于地图之上的半透明面板 |

---

## 3. 功能色 Functional

| 语义 | 主色 | 浅色底 | 说明 |
| --- | --- | --- | --- |
| **Info / 进行中** | `#4F74F0` | `rgba(89,126,247,0.14)` · `#EAF1FF` | 与主色同源，表示处理中 |
| **Success / 成功** | `#1F9D57` | `rgba(34,168,94,0.16)` · `#F0FDF4` | 深色文本可用 `#15803D`；进度条实心用 `#22C55E`，悬停底 `#DCFCE7` |
| **Warning / 警告** | `#F0A020` | `#FFF7E8` ※ | 错误提示图标、需注意但不阻断的操作 |
| **Danger / 失败** | `#E64B4B` | `rgba(245,108,108,0.16)` · `#FFECEC` | 深色文本可用 `#F04444` |
| **Neutral / 未开始** | `#8A94A6` | `#EEF1F5` · `#F1F4F8` | 未处理、待计算等空状态 |

---

## 4. 状态标签规范

统一「圆角胶囊 + 浅底 + 同色系深字」，高度 `20px`、圆角 `10px`、字号 `12px`、字重 `600`。

| 状态 | 文案 | 文字色 | 背景色 |
| --- | --- | --- | --- |
| `pending` | 未处理 / 待计算 | `#8A94A6` | `#EEF1F5` |
| `processing` | 正在处理 | `#4F74F0` | `rgba(89,126,247,0.14)` |
| `done` | 处理完成 | `#1F9D57` | `rgba(34,168,94,0.16)` |
| `failed` | 计算失败 | `#E64B4B` | `rgba(245,108,108,0.16)` |

> 进度面板中的同义标签使用不透明浅底版本：蓝 `#EAF1FF/#4F73FF`、绿 `#F0FDF4/#15803D`、红 `#FFECEC/#F04444`、灰 `#F1F4F8/#8A94A6`。

---

## 5. 字体 Typography

### 5.1 字体家族

| 场景 | 字体 | 字体文件 |
| --- | --- | --- |
| **标题字体**：系统头部标题、登录页标题 | `YouSheBiaoTiHei`（优设标题黑） | `/fonts/YouSheBiaoTiHei-2.ttf` |
| **正文字体**：其余全部界面文字 | `Alibaba PuHuiTi 2.0`（阿里巴巴普惠体） | `/fonts/ALiBaBaPuHuiTi2.0.ttf` |

```css
@font-face {
  font-family: 'YouSheBiaoTiHei';
  src: url('/fonts/YouSheBiaoTiHei-2.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: 'Alibaba PuHuiTi';
  src: url('/fonts/ALiBaBaPuHuiTi2.0.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* 正文默认 */
body {
  font-family: 'Alibaba PuHuiTi', 'Microsoft YaHei', sans-serif;
}

/* 标题专用 */
.system-title,
.header-title {
  font-family: 'YouSheBiaoTiHei', sans-serif;
}
```

### 5.2 字号与字重

| 层级 | 字号     | 字重 | 字体 | 用途 |
| --- |--------| --- | --- | --- |
| 系统标题 | `28px` | `normal` | 优设标题黑 | 头部系统名、登录页标题 |
| 结果数值 | `30px` | `700` | 普惠体 | 指标计算结果等大数字，可加 `letter-spacing: 1px` |
| 面板标题 | `16px` | `600` | 普惠体 | 进度面板标题、导航文字 |
| 区块标题 | `14px` | `600` | 普惠体 | 分组标题、区块小标题 |
| 正文 | `14px` | `400` | 普惠体 | 表格内容、表单文本 |
| 辅助文字 | `12px` | `400` / `600` | 普惠体 | 图例、状态标签、单位说明 |
| 极小文字 | `10px` | `400` | 普惠体 | 折叠箭头等装饰性符号 |

**字重取值**：仅使用 `400`（常规）、`500`（中等）、`600`（半粗，标题与标签主用）、`700`（加粗，仅用于结果数值）。

**行高**：正文 `22px`，紧凑列表 `18px`，标签 `16px`；未指定处沿用默认 `1.5`。

---

## 6. 阴影

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `shadow-sm` | `0 4px 16px rgba(25,55,110,0.08)` | 侧边栏、常驻容器 |
| `shadow-md` | `0 6px 18px rgba(20,52,105,0.16)` | 图例、浮层面板 |
| `shadow-lg` | `0 8px 24px rgba(20,52,105,0.16)` | 地图上的悬浮卡片 |
| `shadow-primary-lg` | `0 16px 36px rgba(23,57,222,0.25)` | 登录卡片的蓝色投影（2026-09-30 补充，取自旧登录页） |

---

## 7. CSS 变量落地

```css
:root {
  /* 主题色 */
  --color-primary: #597ef7;
  --color-primary-hover: #4f74f0;
  --color-primary-border: #c9d4fb;
  --color-primary-border-hover: #9fb3ff;
  --color-primary-bg: #eef3ff;
  --color-primary-bg-light: #f3f6ff;

  /* 文本 */
  --color-text-title: #1f2937;
  --color-text-strong: #2f3a4f;
  --color-text-primary: #333333;
  --color-text-regular: #4b5563;
  --color-text-secondary: #8a94a6;
  --color-text-placeholder: #9aa5b8;
  --color-text-disabled: #c7ced9;

  /* 边框与背景 */
  --color-border: #e6ebf3;
  --color-border-light: #edf1f7;
  --color-divider: #e2e5ec;
  --color-bg-page: #f5f7fb;
  --color-bg-container: #ffffff;

  /* 功能色 */
  --color-info: #4f74f0;
  --color-info-bg: rgba(89, 126, 247, 0.14);
  --color-success: #1f9d57;
  --color-success-bg: rgba(34, 168, 94, 0.16);
  --color-warning: #f0a020;
  --color-warning-bg: #fff7e8;
  --color-danger: #e64b4b;
  --color-danger-bg: rgba(245, 108, 108, 0.16);
  --color-neutral: #8a94a6;
  --color-neutral-bg: #eef1f5;

  /* 字体 */
  --font-family-title: 'YouSheBiaoTiHei', sans-serif;
  --font-family-base: 'Alibaba PuHuiTi', 'Microsoft YaHei', sans-serif;
  --font-size-display: 30px;
  --font-size-title: 28px;
  --font-size-lg: 16px;
  --font-size-base: 14px;
  --font-size-xs: 12px;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* 阴影 */
  --shadow-sm: 0 4px 16px rgba(25, 55, 110, 0.08);
  --shadow-md: 0 6px 18px rgba(20, 52, 105, 0.16);
  --shadow-lg: 0 8px 24px rgba(20, 52, 105, 0.16);
  --shadow-primary-lg: 0 16px 36px rgba(23, 57, 222, 0.25);
}
```
