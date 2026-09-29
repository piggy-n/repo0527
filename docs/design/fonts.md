# 字体

相关决策：ADR 0012
对应文件：`apps/web/src/app/styles/fonts.scss`、`apps/web/src/app/styles/tokens.scss`

## 总览

| 用途 | 字体 | 实现方式 | 文件位置（都不入库） |
|---|---|---|---|
| 正文 | 阿里巴巴普惠体 3.0 | 网页字体，只声明 400、600 | `apps/web/public/fonts/` |
| 系统名称 | 优设标题黑 | 生成 SVG 轮廓，见 [modules/system-title.md](../modules/system-title.md) | `local-assets/fonts/` |
| 后备 | 微软雅黑等系统字体 | 字体文件缺失或下载完成前显示 | — |

设计规范原文里的 `--font-family-title` 令牌已删除：标题字体不作为网页字体加载，用它写的文字只会显示后备字体。

## 为什么字体文件不提交

仓库在 GitHub 上公开。据第三方转述的阿里巴巴普惠体许可协议条款（[iconfont 字体详情](https://www.iconfont.cn/fonts/detail?cnid=adI1E7HF7yme)、[数英的发布报道](https://www.digitaling.com/articles/448979.html)），它永久免费商用，但：

- 禁止上传、发布、转载字体文件：提交到公开仓库就是发布
- 禁止修改、转换、拆分：所以不能自己子集化、切片或转换格式，只能原样使用官方提供的文件
- 企业需下载字体包自行发布使用：部署到自己的网站上使用属于这种情况

优设标题黑由作者声明免费商用（[优设官网](https://www.uisdc.com/uisdc-first-free-font)），但对放进公开仓库、子集化、格式转换没有找到明确说明，所以同样不提交，也不作为网页字体加载。

**以上条款来自第三方转述，正式使用前请以官方原文为准。**

## 目录约定

```
local-assets/fonts/                 两个 TTF 原文件，生成系统名称轮廓时读取
├─ YouSheBiaoTiHei-2.ttf            优设标题黑
└─ ALiBaBaPuHuiTi2.0.ttf            普惠体 2.0 35 Thin，已被 3.0 取代，不使用
apps/web/public/fonts/              运行时加载的网页字体，构建时被复制到 dist/fonts/
├─ AlibabaPuHuiTi-3-55-Regular.woff2
└─ AlibabaPuHuiTi-3-75-SemiBold.woff2
```

两个目录都在 `.gitignore` 中。新 clone 仓库后，从团队的共享位置取得字体包（官方下载的 `AlibabaPuHuiTi-3` 目录），按上面的位置放置：WOFF2 在各字重子目录中，文件名不变。

缺少文件时的表现：

- 缺少普惠体：正文回退为微软雅黑，构建和测试都不受影响（`public/` 下的地址构建时不解析，Vite 只打印"didn't resolve at build time"的提示）
- 缺少优设标题黑：不影响运行，系统名称使用已提交的轮廓；只是修改名称后无法重新生成，测试会提示

## 普惠体的加载方式

```scss
@font-face {
  font-family: 'Alibaba PuHuiTi';
  font-weight: 400;
  font-display: swap;
  src:
    local('Alibaba PuHuiTi 3 55 Regular'),
    local('AlibabaPuHuiTi_3_55_Regular'),
    url('/fonts/AlibabaPuHuiTi-3-55-Regular.woff2') format('woff2');
}
```

| 写法 | 作用 |
|---|---|
| 同一个 `font-family` 下每个字重一个 `@font-face` | 开发时只改 `font-weight`，浏览器自动选择对应文件 |
| `font-display: swap` | 字体到达前先用后备字体显示，不阻塞渲染 |
| `local()` 写在最前 | 本机已安装同款字体时直接使用，不下载。名称取自字体内的完整名称和 PostScript 名称；75 SemiBold 的完整名称末尾带空格，所以只写 PostScript 名称 |
| 官方 WOFF2 | 官方直接提供，无需自己转换 |

### 字重

只加载 400 和 600 两个字重，覆盖规范中的正文（400）以及面板标题、区块标题、标签（600）。按 CSS 的字重匹配规则：

| 写的 `font-weight` | 实际使用 |
|---|---|
| 400 | 55 Regular |
| 500 | 55 Regular（请求值在 400～500 之间时，先找不超过 500 的更粗字重，没有再向下找） |
| 600 | 75 SemiBold |
| 700 | 75 SemiBold（向上没有更粗的，退回最接近的 600；不会人工加粗） |

已验证：用 canvas 测量同一段英文，400 与 500 宽度相同，600 与 700 宽度相同。

### 性能

- 每个字重的 WOFF2 约 5.1～5.5 MB，按授权不能子集化
- 浏览器只下载页面实际用到的字重（已验证：只有常规体文字的页面，600 的状态为未加载）
- 首次访问下载后由浏览器缓存；部署时给 `/fonts/` 设置长期缓存，见 [deployment.md](../deployment.md)
- 字体到达前显示微软雅黑，到达后会有一次字体切换

## 修改时的检查清单

- 增加字重：在 `fonts.scss` 增加一个 `@font-face`，把官方 WOFF2 放进 `apps/web/public/fonts/`，更新本文和 [theme.md](theme.md)；注意每个字重约 5 MB
- 升级字体版本：同时更新 `local()` 中的名称（可从字体文件的 name 表读取）
- 不要把字体文件移到 `src/` 下用相对路径引用：那样 Vite 构建时会解析它，文件缺失时构建直接失败，CI 也会失败
