# 部署要求

发布流程（版本号、CHANGELOG、CD）在首次部署前另写 ADR 决定（ADR 0005）。本文记录前端对服务器的要求。

## 构建产物

构建后，`apps/yzt/dist/` 是纯静态文件，由 nginx 等静态服务器提供。按部署环境选择构建命令（ADR 0032）：

| 环境 | 命令 | 区别 |
|---|---|---|
| 能访问公网 | `pnpm build` | 地图使用天地图底图 |
| 内网（不能访问公网） | `pnpm build:intranet` | 不向天地图发任何请求，底图是"静态底图"（默认，数据随产物发布，ADR 0133）和"无底图" |

两条命令输出到同一个目录，后一次覆盖前一次；nginx 配置相同。

两种构建都检查产物里没有原型和模型数据（`public/` 只放要发布的文件，见 [config/local-files.md](config/local-files.md)）、开发页没有进入产物、MapLibre 没有成为入口的静态依赖；内网构建还检查天地图 key 已清空且未残留在文本产物中。检查失败时不能使用该次产物部署，规则见 [config/vite-config.md](config/vite-config.md) 的“构建产物检查”。

### 构建前放入字体

普惠体的字体文件按授权不能提交到公开仓库（ADR 0012），所以仓库和 CI 中都没有。用于部署的构建，要在构建前把字体放进 `apps/yzt/public/fonts/`（文件名和来源见 [design/fonts.md](design/fonts.md)），构建时整个目录会被复制到 `dist/fonts/`。

构建完成后检查 `dist/fonts/` 下有 `AlibabaPuHuiTi-3-55-Regular.woff2` 和 `AlibabaPuHuiTi-3-75-SemiBold.woff2`。缺少时页面仍能正常使用，但正文会显示为微软雅黑。

`dist/fonts/` 中还会有 `YouSheBiaoTiHei-2.ttf`：它只供生成系统名称轮廓使用，页面不加载（ADR 0013）。不希望对外提供时，用下面 nginx 配置中注释掉的 `location` 禁止访问。

### 3DT 模型数据单独部署

三维模型的清单 `public/3dt/manifest.json` 入库，随构建进入 `dist/3dt/`。模型数据（`SZ_3DT/` 等，2026-10-29 合计约 1.5 GB）不入库，也不进产物：本机开发时放在 `local/3dt/` 下，由开发服务器映射到 `/3dt/*`（[config/local-files.md](config/local-files.md)）；`public/3dt/` 里只有清单，产物检查保证 `dist/3dt/` 里没有别的内容（[config/vite-config.md](config/vite-config.md) 的"构建产物检查"）。

服务器上把模型数据放在发布目录之外，例如前端在 `/opt/front/dist/` 时：

```
/opt/front/
├─ dist/      每次发布整体替换，含 3dt/manifest.json
└─ 3dt/       模型数据，增删模型时单独上传，发布前端时不动
   ├─ JKQ/
   ├─ JKQ2/
   ├─ SZ_3DT/
   ├─ SZ_WhiteModel/
   └─ XZ_GC_3DT/
```

- 地址不变：页面请求同源的 `/3dt/manifest.json`，清单里的 `tileset` 写相对清单的路径（如 `SZ_3DT/tileset.json`），不写服务器地址，开发和部署用同一份清单
- 清单从 `dist` 取、模型数据从模型目录取（nginx 配置见下）：清单的格式由代码里的 zod 校验，跟着代码一起发布
- 新增模型：先把目录上传到模型目录，再改清单、发布前端；LCC2 模型重新上传时，转发上有缓存的先清空缓存（见下面"重新上传以后"）。清单里有、服务器上没有的模型，在三维模型面板里显示加载失败，其他模型不受影响。显存放不下的模型可以给它写 `maximumScreenSpaceError`（像素，不写是 8，放不下的写 16），取值和代价见 [map-cesium](modules/map-cesium.md) 的"瓦片集的显存预算"
- 模型的文件多（`XZ_GC_3DT` 有 1000 多个），打成压缩包上传后在服务器上解压

### LCC2（高斯泼溅）模型的转发

LCC2 模型（`kind: 'splat'`）和其他模型一样平铺在 `/3dt/` 下，层级是 `3dt/<模型名>/lcc2-sog-result/<模型名>.lcc2`（[config/3dt-manifest.md](config/3dt-manifest.md)）。一份数据可能有几个 GB，留在数据方的服务器上，nginx 按模型目录转发，页面看到的仍是同源的 `/3dt/...`，不另开前缀（ADR 0149 第 3 节）；数据放在本机的模型目录里时由下面"nginx 需要的配置"里的 `alias` 提供，要求相同。

gaussian-splat-lite 按段读数据块（`.sog`）：先请求 `bytes=0-4095`，再按需要读后面的段。转发要满足：

- **支持 Range**：返回 206 和 `Content-Range`。返回 200 时库把整个文件下载下来，能显示，但慢，也更占内存。nginx 提供静态文件、转发不加缓存时都原样支持；
- **不压缩**：`.sog`、`.lcc2`、`.ply`、`.btree` 不在 `mime.types` 里，按 `default_type`（通常是 `application/octet-stream`）发送，不要把它或 `*` 加进 `gzip_types`，也不要放预压缩的 `.gz`；转发时让上游也不压缩（`proxy_set_header Accept-Encoding ""`）。`Content-Encoding` 不是 identity 时库不用 Range；
- **`ETag` 不变**：库用第一段（`bytes=0-4095`）的 `ETag` 和后面每一段比，不一样就当文件变了，这个数据块加载失败、库不自己重试；刷新页面，或者在三维模型面板里点这个模型的"重试"（重新加载这个模型，重新打开这些文件），才读新的文件。nginx 的静态文件按修改时间和大小生成；转发时原样带上游的，不要 `proxy_hide_header ETag`，上游有几台机器时各台的文件和修改时间要一致；
- **要缓存时用 `slice`**：转发上加 `proxy_cache` 而不分片时，没命中缓存的请求 nginx 向上游要整个文件：上游返回 `Accept-Ranges: bytes` 时，客户端要等下载到它请求的位置才有响应；上游不返回时，客户端拿到 200 和整个文件（见"支持 Range"）。要缓存就用 `slice` 按 1 MB 分片缓存（`ngx_http_slice_module`，用 `nginx -V` 看有没有 `--with-http_slice_module`）；不需要缓存就不写 `proxy_cache`。分片时 nginx 检查各片的 `ETag` 一致，上一条不满足会报错；
- **重新上传以后**：数据方重新导出、重新上传 LCC2 以后，旧的分片还在缓存里（`inactive=7d`），新旧两份的 `ETag` 不一样，库读到就失败，旧的索引还会画在新的摆放上。所以先清空缓存目录（如 `/var/cache/nginx/3dt`）再 `nginx -s reload`，或者换一个模型目录名，然后再发布带新摆放的清单；没加缓存时只要先上传、再发布清单。浏览器也会缓存：响应没有 `Cache-Control` 时，浏览器可以按 `Last-Modified` 自己估一个有效期，期间不问服务器，所以示例里加了 `Cache-Control: no-cache`，浏览器每次先用 `ETag` 向服务器确认；
- **中文文件名**：清单里的地址按 URL 编码写（`%E6%A5%9A...`）。`location` 按解码后的路径匹配，配置文件要存成 UTF-8；`proxy_pass` 不带路径时，浏览器发来的编码地址原样转给上游，所以上游也要在 `/3dt/<模型名>/` 下提供；带路径时 nginx 用解码后的地址替换前缀，中文一定要用下面的 curl 验收。放在本机时，用 Windows 自带的 `tar` 打成 `.tar`，文件名是 UTF-8（2026-11-10 在中文 Windows 上验证）；不要打 `.zip`：zip 里的中文名是 GBK、不标 UTF-8（`tar -a` 打的 zip 也是），在 Linux 上解压会变成乱码。只有 zip 时，Ubuntu 的 unzip 可以指定编码：Windows 上打的用 `unzip -O CP936`，标成 Unix 上打的（包括 `tar -a` 打的）用 `unzip -I CP936`。解压后都用 `ls` 看一眼。

```nginx
# 写在 http 块里：要缓存时才需要
# proxy_cache_path /var/cache/nginx/3dt keys_zone=lcc2:10m max_size=20g inactive=7d;

server {
    # ……下面"nginx 需要的配置"的内容……

    # LCC2 模型留在数据方的服务器上：每个模型一个 location，比 /3dt/ 长，优先匹配
    location /3dt/楚王山1号/ {
        proxy_pass http://<数据方地址>;
        proxy_http_version 1.1;
        proxy_set_header Accept-Encoding "";
        gzip off;
        # 浏览器每次先用 ETag 确认，重新上传后不会用旧的
        add_header Cache-Control "no-cache";

        # 可选：缓存，按 1 MB 分片
        # slice 1m;
        # proxy_cache lcc2;
        # proxy_cache_key $uri$is_args$args$slice_range;
        # proxy_set_header Range $slice_range;
        # proxy_cache_valid 200 206 7d;
    }
}
```

**验收**：取一个数据块的开头和后面另一个 1 MB 分片里的一段（文件 4297496 字节，第二段在从 2 MB 开始的第 3 片里），都应当得到 206、对应的 `Content-Range`，没有 `Content-Encoding`，两次的 `ETag` 相同。加了缓存时先清空缓存再测：两段落在不同的分片里，都要从上游取，比的是上游的两次响应（同一片里的第二次请求命中缓存，总是一样的）；上游有几台机器时对每一台测一遍。

```bash
curl -s -o /dev/null -D - -r 0-4095 "http://<主机>/3dt/%E6%A5%9A%E7%8E%8B%E5%B1%B11%E5%8F%B7/lcc2-sog-result/data/3dgs/0_0.sog"
```

```bash
curl -s -o /dev/null -D - -r 2097152-2101247 "http://<主机>/3dt/%E6%A5%9A%E7%8E%8B%E5%B1%B11%E5%8F%B7/lcc2-sog-result/data/3dgs/0_0.sog"
```

- 本机实测（2026-11-10）：开发服务器（Vite + sirv 提供 `local/3dt/`）对楚王山1号的 `0_0.sog` 返回 `206 Partial Content`、`Content-Range: bytes 0-4095/4297496`、`Content-Length: 4096`，没有压缩；开发服务器不发 `ETag`（`Cache-Control: no-store`）
- 真实的 nginx 本机没有，上面的配置**未实测**，首次部署时按上面的命令确认

### 调整资源的最小显示级别

`dist/resource-min-zooms.json` 决定每个资源放大到几级才显示、才请求瓦片（ADR 0132、0137）。换后端环境或重新切片后，用 `probe:resource-classes --tile-cost` 重测（[commands.md](commands.md)），它输出的同名文件格式相同，人工确认后可以直接替换；不用重新构建，用户刷新页面就生效。

```json
{ "csxhjctb_lrdl": 9, "bgdc_lmfw": 8 }
```

- 键是资源的 `code`，值是 0～15 的整数；没写的资源不限制，`{}` 表示都不限制
- 文件读不到或者格式不对（包括 nginx 回退成 `index.html`）时，用构建时带上的层级，浏览器控制台有一条警告；整份不用，不会只用对的那几项
- `dist` 每次发布整体替换，确定下来的值要同步回仓库的 `apps/yzt/src/features/resource-map/resource-min-zooms.json`，否则下次发布就还原了
- 构建时 `VITE_RESOURCE_MIN_ZOOM_ENABLED=false` 的产物不读这个文件，都不限制；改这个开关要重新构建
- 村级调查区、界线、路面范围的层级不只看实测大小（ADR 0136），放开前先确认后端的瓦片缓存

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

- Cesium 的运行时文件（ADR 0091，只有 `VITE_MAP_3D_ENGINE=cesium` 的产物才有）：三维的 Worker 脚本、资源复制在 `cesium/` 下，每个 Worker 实例都会请求一遍同一个脚本。带哈希的 `cesium/Workers/chunk-*.js` 配长缓存，不带哈希的入口脚本（如 `cesium/Workers/createVerticesFromHeightmap.js`）和 `cesium/Assets/` 用协商缓存；首次部署时补充并验证
- 矢量瓦片的 gzip 压缩：后端不压缩瓦片，地类图斑低层级单张可达数 MB（2026-10-09 实测 z5 约 8.6 MB，z8 的一张 gzip 后为原来的 31%，见 [docs/archive/migration.md](archive/migration.md)"现状底图：接口实测"）。新项目的瓦片走同源的 `/backend/api/tiles/`，在 `/backend/` 的转发里对 `application/x-protobuf` 开启 gzip（旧项目 README 的写法：`gzip_proxied any`、`gzip_types application/x-protobuf …`）；首次部署时补充并验证
- 静态资源缓存：带哈希的 `assets/*` 可以长期缓存，`index.html` 不应缓存；`fonts/*` 每个约 5 MB、文件名带版本号，应长期缓存；`3dt/` 的模型文件不带哈希，用协商缓存。首次部署时补充
