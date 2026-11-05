# 方案 C 实测：MapLibre + Three.js 对比 Cesium

在有显卡的机器上，用同样的模型、视角、视口和底图，记录方案 C（二三维都用 MapLibre，模型用 Three.js）和现状 Cesium 的性能，再加 LCC2 高斯泼溅。这是一次性的验证工程。

**这个分支不合入 main。** 工程放在 `tools/poc/maplibre-three/`，不属于仓库的 workspace，依赖单独安装，不影响主应用。

## 要准备什么

- Windows 10 或 11，真实的显卡（不要在远程桌面或虚拟机里跑）
- Chrome（没有时可以用 Playwright 自带的 Chromium，见下面）
- Node 24、pnpm
- 模型目录和 LCC2 样例，都不在仓库里，要从原来的机器复制：

| 复制什么 | 复制到（相对仓库根） | 大小 |
|---|---|---|
| `local/3dt`（要有 `SZ_3DT`、`SZ_WhiteModel`、`XZ_GC_3DT`） | `local/3dt` | 约 1.5 GB |
| LCC2 样例目录（里面有 `.lcc2` 文件） | `local/lcc2/render2` | 约 2.3 GB |

不想复制到这两个位置时，运行前设置环境变量：`YZT_LOCAL_DIR` 指向包含 `3dt` 的目录，`LCC2_DIR` 指向 LCC2 样例目录。

天地图的 key 不是必需的，测量默认用 ArcGIS 影像。

## 步骤

1. 拉分支。机器上还没有仓库时：

```bash
git clone --depth 1 --branch poc/maplibre-three-gpu https://github.com/piggy-n/repo0527.git
```

已经有仓库时，在仓库根目录运行：

```bash
git fetch origin poc/maplibre-three-gpu:poc/maplibre-three-gpu
```

```bash
git switch poc/maplibre-three-gpu
```

2. 从仓库根目录进入工程目录：

```bash
cd tools/poc/maplibre-three
```

3. 安装依赖。有两个工程，都要装。不用在仓库根目录运行 `pnpm install`：

```bash
pnpm install --ignore-workspace --config.strictDepBuilds=false
```

```bash
pnpm -C lcc2 install --ignore-workspace --config.strictDepBuilds=false
```

`--config.strictDepBuilds=false` 是因为 pnpm 12 默认不跑 esbuild 的安装脚本并报错退出。esbuild 不需要这个脚本也能用。

4. 确认用的是独显。双显卡的机器到 **Windows 设置 → 系统 → 显示 → 图形**，把 Chrome 设为"高性能"。脚本也会尽量请求独显，并在开始时打印实际用的是哪一块。

5. 运行。关掉其他占显卡的程序，插上电源，运行期间不要用这台机器：

```bash
pnpm measure
```

预计全部场景约 35 分钟（一共 20 个，每个 1 到 2 分钟，这个时长是估算，脚本会显示进度和剩余时间）。屏幕上会轮流弹出浏览器窗口，不要关，也不要最小化。

6. 填人工检查项（脚本判断不了的）。运行下面的命令，按打开的页面逐项看，把结论写进结果目录的 `manual.md`：

```bash
pnpm manual
```

看完关掉浏览器窗口，服务会自动退出。要比较模型和天地图的对齐时，先在这个目录建一个 `.env.local`，写一行 `VITE_TIANDITU_KEY=你的key`，不要提交。

7. **把 `results/<时间戳>/` 整个目录带回来。** 里面的东西：

| 文件 | 内容 |
|---|---|
| `report.md` | 并排对比，标明无效和超时 |
| `raw.json` | 原始数字 |
| `manual.md` | 人工检查项，要你填 |
| `screenshots/` | 每个场景的截图 |

结果里不包含主机名、用户名和 key，也不要把这个目录提交到公开的仓库。

## 常用选项

| 选项 | 用途 |
|---|---|
| `pnpm measure --list` | 列出所有场景 |
| `pnpm measure --only oblique-z19,lcc2-3m` | 只跑部分场景，失败后补测 |
| `pnpm measure --only white-z15.5/cesium` | 只跑某个场景的某个方案 |
| `pnpm measure --repeat 3` | 每个场景跑 3 次，报告取中位数 |
| `pnpm measure --basemap none` | 没有网络时用，两个引擎都不要底图 |
| `pnpm measure --viewport 1920x1080` | 换视口，默认 1600×900 |
| `pnpm measure --only oblique --cache-mb 900,2000` | 倾斜摄影另外跑一个 2000 MB 缓存的方案 C |
| `pnpm measure --help` | 全部选项 |

每跑完一个场景就会写一次结果，中途中断也留得下数据，已经跑完的场景不用重测。单个场景失败只记录，接着跑下一个。要中断时按 Ctrl+C，正在跑的那个场景可能作废，之后用 `--only` 补测。

## 常见问题

- **"现在用的是软件渲染"：** 脚本看到 SwiftShader、llvmpipe、Basic Render 这类渲染器会直接退出，因为这种结果没有意义。更新显卡驱动，不要用远程桌面。
- **"帧率上限没有解除"：** 不影响运行，但帧时间可能封顶在刷新率上，这时看报告里的每帧 JS 和每帧 GPU。
- **显存一栏是"取不到"：** 报告末尾写了原因，把报告带回来就行。
- **没有 Chrome：** 运行下面的命令安装 Playwright 自带的 Chromium，脚本会自动用它：

```bash
pnpm exec playwright install chromium
```

- **某个 LCC2 预算崩溃：** 脚本记录后继续，把结果带回来就行。这本身就是要看的。

## 工程结构

| 位置 | 内容 |
|---|---|
| `tools/measure.mjs`、`tools/lib/` | 测量脚本：启动前检查、场景表、探针、报告 |
| `tools/manual.mjs`、`manual.html` | 人工检查页 |
| `bench-c.html`、`bench-cesium.html`、`src/bench/` | 测量用的页面，只有底图和模型 |
| `src/own-layer.ts`、`src/roam-scene.ts` | 方案 C 的自写 custom layer 和独立 Three 场景 |
| `lcc2/` | LCC2 工程，依赖的 `three` 版本不同，所以单独安装 |
| `index.html`、`src/main.ts` | 早期的综合测试页，人工检查对齐时用 |

Cesium 对照组直接用 `packages/map-cesium` 的 `SceneTilesets`（缓存 384 MB 加 256 MB 溢出）、`SceneUnderground` 和相机换算，所以这个目录要留在完整的仓库里。各项指标的口径写在生成的 `report.md` 末尾。
