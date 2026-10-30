# 部署要求

发布流程（版本号、CHANGELOG、CD）在首次部署前另写 ADR 决定（ADR 0005）。本文记录前端对服务器的要求。

## 构建产物

构建后，`apps/web/dist/` 是纯静态文件，由 nginx 等静态服务器提供。按部署环境选择构建命令（ADR 0032）：

| 环境 | 命令 | 区别 |
|---|---|---|
| 能访问公网 | `pnpm build` | 地图使用天地图底图 |
| 内网（不能访问公网） | `pnpm build:intranet` | 不向天地图发任何请求，底图只有"无底图" |

两条命令输出到同一个目录，后一次覆盖前一次；nginx 配置相同。

两种构建都自动清理产物中的 `design.local/`（源设计稿保留），并检查开发页没有进入产物、MapLibre 没有成为入口的静态依赖；内网构建还检查天地图 key 已清空且未残留在文本产物中。检查失败时不能使用该次产物部署，规则见 [config/vite-config.md](config/vite-config.md) 的“构建产物检查”。

### 构建前放入字体

普惠体的字体文件按授权不能提交到公开仓库（ADR 0012），所以仓库和 CI 中都没有。用于部署的构建，要在构建前把字体放进 `apps/web/public/fonts/`（文件名和来源见 [design/fonts.md](design/fonts.md)），构建时整个目录会被复制到 `dist/fonts/`。

构建完成后检查 `dist/fonts/` 下有 `AlibabaPuHuiTi-3-55-Regular.woff2` 和 `AlibabaPuHuiTi-3-75-SemiBold.woff2`。缺少时页面仍能正常使用，但正文会显示为微软雅黑。

`dist/fonts/` 中还会有 `YouSheBiaoTiHei-2.ttf`：它只供生成系统名称轮廓使用，页面不加载（ADR 0013）。不希望对外提供时，用下面 nginx 配置中注释掉的 `location` 禁止访问。

### 3DT 模型数据单独部署

三维模型的清单 `public/3dt/manifest.json` 入库，随构建进入 `dist/3dt/`。模型数据（`SZ_3DT/` 等，2026-10-29 合计约 1.5 GB）不入库，也不进产物：本机开发时放在 `apps/web/public/3dt/` 下，构建时删除 `dist/3dt/` 里清单以外的内容（[config/vite-config.md](config/vite-config.md) 的"构建产物检查"）。

服务器上把模型数据放在发布目录之外，例如前端在 `/opt/front/dist/` 时：

```
/opt/front/
├─ dist/      每次发布整体替换，含 3dt/manifest.json
└─ 3dt/       模型数据，增删模型时单独上传，发布前端时不动
   ├─ SZ_3DT/
   ├─ SZ_WhiteModel/
   └─ XZ_GC_3DT/
```

- 地址不变：页面请求同源的 `/3dt/manifest.json`，清单里的 `tileset` 写相对清单的路径（如 `SZ_3DT/tileset.json`），不写服务器地址，开发和部署用同一份清单
- 清单从 `dist` 取、模型数据从模型目录取（nginx 配置见下）：清单的格式由代码里的 zod 校验，跟着代码一起发布
- 新增模型：先把目录上传到模型目录，再改清单、发布前端。清单里有、服务器上没有的模型，在三维模型面板里显示加载失败，其他模型不受影响
- 模型的文件多（`XZ_GC_3DT` 有 1000 多个），打成压缩包上传后在服务器上解压

## nginx 需要的配置

```nginx
server {
    listen 80;
    root /path/to/dist;

    # 接口：同源转发到后端并去掉 /backend 前缀（ADR 0008）
    # proxy_pass 末尾的 / 表示用它替换 location 匹配到的 /backend/
    location /backend/ {
        proxy_pass http://<后端地址>/;
    }

    # AI 对话的后端（另一个服务）：同样去掉前缀；回答用 SSE 推送，关掉缓冲才能逐段到达，
    # 回答可能要几分钟，读超时放长。AI 后端的部署地址、内网是否部署尚未确定（docs/modules/ai-chat.md）
    location /ai-backend/ {
        proxy_pass http://<AI 后端地址>/;
        proxy_buffering off;
        proxy_read_timeout 30m;
    }

    # 页面：history 模式下，未知路径回退到 index.html，由前端路由处理（ADR 0007）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 3DT 清单随前端发布，从 root 取；精确匹配优先于下面的 /3dt/
    location = /3dt/manifest.json {
        try_files $uri =404;
    }

    # 3DT 模型数据在发布目录之外；alias 的两端都以 / 结尾。缺文件时返回 404，不回退到 index.html
    location /3dt/ {
        alias /path/to/3dt/;
    }

    # 可选：禁止下载只供构建工具使用的 TTF 字体（ADR 0013）
    # location ~ ^/fonts/.*\.ttf$ {
    #     return 404;
    # }
}
```

以下规则缺一不可：

- 缺少 `try_files`：直接打开或刷新 `/current-map` 这类地址会返回 404
- 缺少 `/backend/` 转发：所有接口请求都会失败
- 缺少 `/3dt/` 的 `alias`：三维模型面板能列出清单，但所有模型都加载失败（瓦片集的地址回退成 `index.html`）

以上配置尚未在真实服务器上验证，首次部署时确认。

## 待补充

- Cesium 的运行时文件（ADR 0091）：三维的 Worker 脚本、资源复制在 `cesium/` 下，每个 Worker 实例都会请求一遍同一个脚本。带哈希的 `cesium/Workers/chunk-*.js` 配长缓存，不带哈希的入口脚本（如 `cesium/Workers/createVerticesFromHeightmap.js`）和 `cesium/Assets/` 用协商缓存；首次部署时补充并验证
- 矢量瓦片的 gzip 压缩：后端不压缩瓦片，地类图斑低层级单张可达数 MB（2026-10-09 实测 z5 约 8.6 MB，z8 的一张 gzip 后为原来的 31%，见 [migration.md](migration.md)"现状底图：接口实测"）。新项目的瓦片走同源的 `/backend/api/tiles/`，在 `/backend/` 的转发里对 `application/x-protobuf` 开启 gzip（旧项目 README 的写法：`gzip_proxied any`、`gzip_types application/x-protobuf …`）；首次部署时补充并验证
- 静态资源缓存：带哈希的 `assets/*` 可以长期缓存，`index.html` 不应缓存；`fonts/*` 每个约 5 MB、文件名带版本号，应长期缓存；`3dt/` 的模型文件不带哈希，用协商缓存。首次部署时补充
