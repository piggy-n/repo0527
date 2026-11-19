# 部署要求

发布流程（版本号、CHANGELOG、CD）在首次部署前另写 ADR 决定（ADR 0005）。本文记录前端对服务器的要求。

## 构建产物

构建后，`apps/yzt/dist/` 是纯静态文件，由 nginx 等静态服务器提供。按部署环境选择构建命令（ADR 0032）：

| 环境 | 命令 | 区别 |
|---|---|---|
| 能访问公网 | `pnpm build` | 地图使用天地图底图 |
| 内网（不能访问公网） | `pnpm build:intranet` | 不向天地图发任何请求，底图是"静态底图"（数据随产物发布，ADR 0133）和"无底图"，加上这台服务器 nginx 配了的服务器底图：标准、影像、黑色、极夜蓝（数据不进产物，见下面"服务器底图单独部署"，ADR 0165）。二维默认有标准时是标准，没有时是静态 |

两条命令输出到同一个目录，后一次覆盖前一次；nginx 配置相同。

两种构建都检查产物里没有原型、模型数据和服务器底图的缓存（`basemap/` 目录、`.bundle`、`.bundlx` 文件；`public/` 只放要发布的文件，见 [config/local-files.md](config/local-files.md)）、开发页没有进入产物、MapLibre 没有成为入口的静态依赖；内网构建还检查天地图 key 已清空且未残留在文本产物中。检查失败时不能使用该次产物部署，规则见 [config/vite-config.md](config/vite-config.md) 的“构建产物检查”。

### 第三方许可

`dist/licenses/<包名>/` 放的是产物里用到的、带 NOTICE 的包要随附的文件：NOTICE、LICENSE，以及两者指向的文件，文件名和包里一样。现在有两个包：

| 目录 | 文件 |
|---|---|
| `licenses/echarts/` | `LICENSE`、`NOTICE`、`licenses/LICENSE-d3` |
| `licenses/gaussian-splat-lite/` | `LICENSE`、`NOTICE`、`THIRD_PARTY_LICENSES.md`（这个包的第三方许可和声明，包括 XGRIDS 对 LCC2 格式的声明，ADR 0149 第 8 节） |

这不是全部依赖的许可：没有 NOTICE 的包（MIT、BSD，以及不带 NOTICE 的 Apache-2.0 包）的许可没有随产物提供，分发前要定（[backlog](backlog.md)"上线前"）。

文件在构建时从安装的版本里取，不入库；随 `dist` 一起发布，不要删。nginx 不用另配，由 `location /` 直接提供，没有扩展名的文件按默认类型下载。哪些包、带哪些文件，以及构建怎么检查，见 [config/vite-config.md](config/vite-config.md) 的“第三方许可”。

### 构建前放入字体

普惠体的字体文件按授权不能提交到公开仓库（ADR 0012），所以仓库和 CI 中都没有。用于部署的构建，要在构建前把字体放进 `apps/yzt/public/fonts/`（文件名和来源见 [design/fonts.md](design/fonts.md)），构建时整个目录会被复制到 `dist/fonts/`。

构建完成后检查 `dist/fonts/` 下有 `AlibabaPuHuiTi-3-55-Regular.woff2` 和 `AlibabaPuHuiTi-3-75-SemiBold.woff2`。缺少时页面仍能正常使用，但正文会显示为微软雅黑。

`dist/fonts/` 中还会有 `YouSheBiaoTiHei-2.ttf`：它只供生成系统名称轮廓使用，页面不加载（ADR 0013）。不希望对外提供时，用下面 nginx 配置中注释掉的 `location` 禁止访问。

### 3DT 模型数据单独部署

三维模型的清单 `public/3dt/manifest.json` 入库，随构建进入 `dist/3dt/`。模型数据不入库，也不进产物：本机开发时放在 `local/3dt/` 下，由开发服务器映射到 `/3dt/*`（[config/local-files.md](config/local-files.md)）；`public/3dt/` 里只有清单，产物检查保证 `dist/3dt/` 里没有别的内容（[config/vite-config.md](config/vite-config.md) 的"构建产物检查"）。

服务器上把模型数据放在发布目录之外，按 `<市>/<类型>/<模型目录>/` 分层（用户 2026-11-11 定，规则见 [config/3dt-manifest.md](config/3dt-manifest.md)"目录层级"），例如前端在 `/opt/front/dist/` 时：

```
/opt/front/
├─ dist/      每次发布整体替换，含 3dt/manifest.json
└─ 3dt/       模型数据，增删模型时单独上传，发布前端时不动
   ├─ suzhou/3dtiles/
   │  ├─ 星海广场站/
   │  └─ 星海广场站周边建筑白模/        plain/、tech/、window/ 各一套
   ├─ wuxi/3dtiles/
   │  ├─ 经开区/
   │  ├─ 新吴区02/
   │  └─ ……
   └─ xuzhou/
      ├─ 3dtiles/彭城广场/
      └─ lcc2/
         ├─ 楚王山1号/lcc2-sog-result/
         ├─ 城下城（测试）/lcc2-sog-result/
         └─ ……
```

- 地址不变：页面请求同源的 `/3dt/manifest.json`，清单里的 `tileset` 写相对清单的路径，每一段按 URL 编码（如 `xuzhou/3dtiles/%E5%BD%AD%E5%9F%8E%E5%B9%BF%E5%9C%BA/tileset.json`，即 `xuzhou/3dtiles/彭城广场/tileset.json`），不写服务器地址，开发和各台服务器用同一套地址；发布的清单是入库的全集按部署站点去掉这台服务器缺的模型（见下面"每台服务器各构建一次"）
- 清单从 `dist` 取、模型数据从模型目录取（nginx 配置见下）：清单的格式由代码里的 zod 校验，跟着代码一起发布
- 内网 Windows 服务器 `192.168.15.111`（2026-11-17 加入，数据齐全）：nginx 1.24（Windows 版），5173 端口提供前端 `D:/01Project/front/dist/`、把 `/backend/` 转到 `192.168.15.111:18010`，`/3dt/` 的 alias 是模型根目录 `D:/02Data/3dtiles/models/`，加了 `Cache-Control: no-cache`；`/basemap/` 下 4 个前缀的 alias 是 `D:/02Data/3dtiles/天地图3857/` 里 4 套底图缓存的 `Layers/`（2026-11-17 配好并验收，见下面"服务器底图单独部署"）。模型数据原来是数据方的目录名，2026-11-17 用户用 `rename-15-111.ps1`（`local/server-setup/`，不入库，改完在服务器上留了撤销脚本）按这个层级改了名（`SZ_3DT` → `星海广场站`、`JKQ` → `经开区`、`XWQ02` → `新吴区02` 等，`城下城` 挪进 `城下城（测试）\lcc2-sog-result\`），新接入的宿迁、徐州模型又按用户定的名称用 `rename-15-111-names.ps1` 改了一轮（`sq01` → `宿豫区01`、`1` → `模型一` 等）；`wuxi\无锡优化` 用户定不用，没有清单引用它。8080 端口另有 `/tiles/` 指向 `D:/02Data/map/bingmaps_satellite/`，应用没有用它。Windows 版 nginx 的配置文件存成 UTF-8 不带 BOM，路径写 `/`，在 nginx 的目录里运行 `.\nginx.exe -t`、`.\nginx.exe -s reload`；中文路径上线前按下面"验收"的 curl 确认
- 内网 `192.168.153.194`（2026-11-11 按这个层级整理）：前端在 `/opt/front/dcjcxzt/`，模型在 `/opt/front/3dt/`，5173 端口的 nginx 把 `/3dt/` alias 到模型目录、不开 gzip，那里的清单要换成 2026-11-11 以后入库的版本，旧清单的路径对不上新的目录
- 测试服务器 `192.168.1.180`（站点 `1-180`，用 `pnpm build` 构建）：前端在 `/opt/front/dist/`，模型在 `/opt/front/3dt/`，5173 端口的 nginx 把 `/3dt/` alias 到模型目录、`/3dt/manifest.json` 另有一个 `location` 从前端取，不开 gzip。模型目录原来是平铺的（`SZ_3DT/`、`XZ_GC_3DT/`、`楚王山1号/` 等），2026-11-18 用户用 `rename-180.sh`（`local/server-setup/`，不入库，只用 `mkdir -p` 和 `mv`，撤销脚本在服务器上的 `/root/undo-rename-180-20261119-103350.sh`）按这个层级挪好：`SZ_3DT` → `suzhou/3dtiles/星海广场站`、`SZ_WhiteModel` → `星海广场站周边建筑白模`、`XZ_GC_3DT` → `xuzhou/3dtiles/彭城广场`、`宿豫区01` → `suqian/3dtiles/宿豫区01`（从 15.111 拷来的），LCC2 原名挪进 `xuzhou/lcc2/`；清单外的楚王山4号、北洞山楚王墓也挪进了 `xuzhou/lcc2/`，根目录留着用户上传的 `宿豫区01.zip`。同日发布按站点构建的前端，`site:check 1-180` 全部通过（13 个模型、15 个入口、9 个 LCC2 的 Range）
- 每台服务器各构建一次（ADR 0164）：部署站点在 `apps/yzt/tools/site/sites.json`，只记这台缺哪些模型（[config/3dt-manifest.md](config/3dt-manifest.md)"按站点发布"）。PowerShell 里 `$env:YZT_SITE = '15-111'; pnpm build:intranet; Remove-Item Env:YZT_SITE`，看构建日志里 `[site]` 那一行的站点和模型数；不设时发布全集。发布后在开发机上运行 `pnpm --filter yzt site:check 15-111` 核对：服务器上的清单是这个站点的组合，每个模型的入口都在，LCC2 的 Range 合格
- 新增模型：先把目录上传到模型目录，再改清单（数据不在某台服务器上时写进那个站点的 `missing`）、按站点构建、发布前端；LCC2 模型重新上传时，转发上有缓存的先清空缓存（见下面"重新上传以后"）。清单里有、服务器上没有的模型，加入以后在面板的图层列表里显示加载失败，其他模型不受影响。显存放不下的模型可以给它写 `maximumScreenSpaceError`（像素，不写是 8，放不下的写 16），取值见 [config/3dt-manifest.md](config/3dt-manifest.md)
- 模型的文件多（彭城广场的倾斜摄影有 1000 多个），打成压缩包上传后在服务器上解压；目录名有中文，打包用 `tar`，不用 `zip`（见下面"中文文件名"）

### LCC2（高斯泼溅）模型的转发

LCC2 模型（`kind: 'splat'`）的层级是 `3dt/<市>/lcc2/<目录>/lcc2-sog-result/<索引>.lcc2`（[config/3dt-manifest.md](config/3dt-manifest.md)）。一份数据可能有几个 GB，可以留在数据方的服务器上，nginx 按模型目录转发，页面看到的仍是同源的 `/3dt/...`，不另开前缀（ADR 0149 第 3 节）；数据放在本机的模型目录里时由下面"nginx 需要的配置"里的 `alias` 提供，要求相同。

gaussian-splat-lite 按段读数据块（`.sog`）：先请求 `bytes=0-4095`，再按需要读后面的段。转发要满足：

- **支持 Range**：返回 206 和 `Content-Range`。返回 200 时库把整个文件下载下来，能显示，但慢，也更占内存。nginx 提供静态文件、转发不加缓存时都原样支持；
- **不压缩**：`.sog`、`.lcc2`、`.ply`、`.btree` 不在 `mime.types` 里，按 `default_type`（通常是 `application/octet-stream`）发送，不要把它或 `*` 加进 `gzip_types`，也不要放预压缩的 `.gz`；转发时让上游也不压缩（`proxy_set_header Accept-Encoding ""`）。`Content-Encoding` 不是 identity 时库不用 Range；
- **`ETag` 不变**：库用第一段（`bytes=0-4095`）的 `ETag` 和后面每一段比，不一样就当文件变了，这个数据块加载失败、库不自己重试；刷新页面，或者在面板的图层列表里点这个模型的"重试"（重新加载这个模型，重新打开这些文件），才读新的文件。nginx 的静态文件按修改时间和大小生成；转发时原样带上游的，不要 `proxy_hide_header ETag`，上游有几台机器时各台的文件和修改时间要一致；
- **要缓存时用 `slice`**：转发上加 `proxy_cache` 而不分片时，没命中缓存的请求 nginx 向上游要整个文件：上游返回 `Accept-Ranges: bytes` 时，客户端要等下载到它请求的位置才有响应；上游不返回时，客户端拿到 200 和整个文件（见"支持 Range"）。要缓存就用 `slice` 按 1 MB 分片缓存（`ngx_http_slice_module`，用 `nginx -V` 看有没有 `--with-http_slice_module`）；不需要缓存就不写 `proxy_cache`。分片时 nginx 检查各片的 `ETag` 一致，上一条不满足会报错；
- **重新上传以后**：数据方重新导出、重新上传 LCC2 以后，旧的分片还在缓存里（`inactive=7d`），新旧两份的 `ETag` 不一样，库读到就失败，旧的索引还会画在新的摆放上。所以先清空缓存目录（如 `/var/cache/nginx/3dt`）再 `nginx -s reload`，或者换一个模型目录名，然后再发布带新摆放的清单；没加缓存时只要先上传、再发布清单。浏览器也会缓存：响应没有 `Cache-Control` 时，浏览器可以按 `Last-Modified` 自己估一个有效期，期间不问服务器，所以示例里加了 `Cache-Control: no-cache`，浏览器每次先用 `ETag` 向服务器确认；
- **中文文件名**：清单里的地址按 URL 编码写（`%E6%A5%9A...`）。`location` 按解码后的路径匹配，配置文件要存成 UTF-8；`proxy_pass` 不带路径时，浏览器发来的编码地址原样转给上游，所以上游也要在同样的 `/3dt/<市>/lcc2/<目录>/` 下提供；带路径时 nginx 用解码后的地址替换前缀，中文一定要用下面的 curl 验收。放在本机时，用 Windows 自带的 `tar` 打成 `.tar`，文件名是 UTF-8（2026-11-10 在中文 Windows 上验证）；不要打 `.zip`：zip 里的中文名是 GBK、不标 UTF-8（`tar -a` 打的 zip 也是），在 Linux 上解压会变成乱码。只有 zip 时，Ubuntu 的 unzip 可以指定编码：Windows 上打的用 `unzip -O CP936`，标成 Unix 上打的（包括 `tar -a` 打的）用 `unzip -I CP936`。解压后都用 `ls` 看一眼。

```nginx
# 写在 http 块里：要缓存时才需要
# proxy_cache_path /var/cache/nginx/3dt keys_zone=lcc2:10m max_size=20g inactive=7d;

server {
    # ……下面"nginx 需要的配置"的内容……

    # LCC2 模型留在数据方的服务器上：每个模型一个 location，比 /3dt/ 长，优先匹配
    location /3dt/xuzhou/lcc2/楚王山1号/ {
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
curl -s -o /dev/null -D - -r 0-4095 "http://<主机>/3dt/xuzhou/lcc2/%E6%A5%9A%E7%8E%8B%E5%B1%B11%E5%8F%B7/lcc2-sog-result/data/3dgs/0_0.sog"
```

```bash
curl -s -o /dev/null -D - -r 2097152-2101247 "http://<主机>/3dt/xuzhou/lcc2/%E6%A5%9A%E7%8E%8B%E5%B1%B11%E5%8F%B7/lcc2-sog-result/data/3dgs/0_0.sog"
```

- 本机实测（2026-11-10）：开发服务器（Vite + sirv 提供 `local/3dt/`）对楚王山1号的 `0_0.sog` 返回 `206 Partial Content`、`Content-Range: bytes 0-4095/4297496`、`Content-Length: 4096`，没有压缩；开发服务器不发 `ETag`（`Cache-Control: no-store`）
- 真实的 nginx 本机没有，上面的配置**未实测**，首次部署时按上面的命令确认

### 服务器底图单独部署

内网服务器可以随服务器提供底图（ADR 0165）：数据方给的 ArcGIS 切片缓存，页面用 Range 直接读，不在服务器上转换。数据不入库（数据方的数据，仓库在 GitHub 上），也不进产物（见上面的产物检查）。nginx 给每套一个英文前缀，`alias` 指到缓存的 `Layers/`：

| 前缀 | 底图 | 地名 | 192.168.15.111 上的目录（`D:/02Data/3dtiles/天地图3857/` 下） |
|---|---|---|---|
| `standard` | 标准 | 印在图上，标注开关置灰 | `江苏省2026年标准版3857L7_18/Layers/` |
| `imagery` | 影像（2025 年 0.5 米，脱密后切图） | 叠静态底图的市、区县地名，跟着标注开关 | `江苏省2025年0_5米影像脱密后切图3857L7_18/Layers/` |
| `black` | 黑色 | 印在图上 | `江苏省2026年黑色版3857L7_18/Layers/` |
| `night-blue` | 极夜蓝 | 印在图上 | `江苏省2026年极夜蓝版3857L7_18/Layers/` |

- 前缀写在代码里（`apps/yzt/src/shared/config/server-basemap-options.ts`，所有部署一样），中文目录名和年份只出现在 nginx 的 `alias` 里：数据方换了目录只改 nginx，不用重新构建
- 每台服务器有哪几套不写进部署站点（`sites.json`），也不用重新构建：进入地图页前，页面读每套南京那块 10 级瓦片（`_alllayers/L10/R0180C0300.bundlx`，再 Range 读同名的 `.bundle`），读到图片的才出现在底图面板里。漏配的只是少一张卡片；一套都没配时只有"静态底图""无底图"，和以前一样
- 二维默认有标准时是标准、没有时是静态；切到三维时有影像就选影像，切回二维选二维默认（ADR 0165 第 1 节）
- 服务器挂住时进入地图页最多多等 3 秒，这次浏览没有服务器底图，浏览器控制台有一条 `[basemap]` 开头的警告，刷新重试；404 和回落成 `index.html` 不警告，没有这些底图的服务器本来就这样
- 只支持第一代紧凑缓存、Web 墨卡托、256 像素的瓦片。数据方换数据时先看缓存的 `Layers/conf.xml`（可以在浏览器里打开 `/basemap/<前缀>/conf.xml`）：`StorageFormat` 是 `esriMapCacheStorageModeCompact`（不是 `…CompactV2`）、`PacketSize` 128、`TileCols` 和 `TileRows` 256、`WKID` 102100 或 3857、`TileOrigin` 是 (-20037508.34, 20037508.34)；有不一样的要改代码（ADR 0165 第 2 节），范围（`conf.cdi`）或级别变了要改那个表
- 数据方更新时可以原地替换：`.bundlx` 带 `no-cache` 和 `ETag`，换了文件浏览器会重新取；`.bundle` 页面一律不缓存（Windows 上的 Chrome、Edge 用缓存回答 Range 有过返回全零的故障），读到的和索引对不上时重读一次索引。代价是刷新页面或拖回早先看过的地方时瓦片要重新下载，局域网里每屏约 1～3 MB
- 不要对 `.bundle`、`.bundlx` 开 gzip：它们不在 `mime.types` 里，按 `default_type`（通常是 `application/octet-stream`）发送，不要把它或 `*` 加进 `gzip_types`。压缩以后不能 Range，页面读不到瓦片（返回 200 时立刻取消，不会下载整个文件）
- 只有 7～18 级：地图级别低于 5.5、三维斜着看时靠近地平线的一带只有背景色（[backlog](backlog.md)）

nginx 写在前端那个 `server` 里（完整的位置见下面"nginx 需要的配置"），`alias` 的两端都以 `/` 结尾；Windows 版 nginx 的配置文件存成 UTF-8 不带 BOM，路径写 `/`：

```nginx
# 没配的前缀回 404，不回落到 index.html；下面更长的前缀优先匹配
location /basemap/ {
    return 404;
}
location /basemap/standard/ {
    alias D:/02Data/3dtiles/天地图3857/江苏省2026年标准版3857L7_18/Layers/;
    add_header Cache-Control "no-cache";
}
location /basemap/imagery/ {
    alias D:/02Data/3dtiles/天地图3857/江苏省2025年0_5米影像脱密后切图3857L7_18/Layers/;
    add_header Cache-Control "no-cache";
}
location /basemap/black/ {
    alias D:/02Data/3dtiles/天地图3857/江苏省2026年黑色版3857L7_18/Layers/;
    add_header Cache-Control "no-cache";
}
location /basemap/night-blue/ {
    alias D:/02Data/3dtiles/天地图3857/江苏省2026年极夜蓝版3857L7_18/Layers/;
    add_header Cache-Control "no-cache";
}
```

**验收**：每个前缀都测，应当得到：`.bundlx` 200、`Content-Length: 81952`；`.bundle` 的 Range 206、`Content-Range: bytes 65596-65611/<文件大小>`，没有 `Content-Encoding`；缺的文件 404；没配的前缀和 `/basemap/` 本身 404（不是 200 的网页）。

```bash
curl -s -o /dev/null -D - "http://<主机>/basemap/standard/_alllayers/L10/R0180C0300.bundlx"
curl -s -o /dev/null -D - -r 65596-65611 "http://<主机>/basemap/standard/_alllayers/L10/R0180C0300.bundle"
curl -s -o /dev/null -w "%{http_code}\n" "http://<主机>/basemap/standard/_alllayers/L10/R0000C0000.bundlx"
curl -s -o /dev/null -w "%{http_code}\n" "http://<主机>/basemap/nothing/conf.xml"
```

- 192.168.15.111（2026-11-17）：4 个前缀都按上面配好，4 套都通过这几项（`.bundlx` 带 `ETag` 和 `Cache-Control: no-cache`，`Content-Type: application/octet-stream`）；中文出现在 `alias` 的磁盘路径里也正常
- 页面上看：登录后打开底图面板，有标准时第一行是标准、影像、静态，第二行是黑色、极夜蓝、无底图，没配的不占位；地图默认是标准底图。开发机上看某台服务器的底图用 `YZT_BASEMAP_PROXY`（[config/local-files.md](config/local-files.md)"服务器底图"）

### 后端新增资源或重新切片以后

资源目录来自后端，新资源不改前端也会出现在资源图层面板里，但只有默认样式：按在树里的顺序取一种颜色、不按属性分类，不限最小显示级别，不能开标注（ADR 0041、0123、0132、0160）。要分类、开标注、限级别，先用只读的探查脚本 `pnpm --filter yzt probe:resource-classes` 采样后端的字段和取值，人工确认后再改代码、重新构建发布。完整的步骤（建输出目录、采样、找出新资源和新年份、分类和标注怎么选、改哪些文件、新年份的覆盖检查）见 [config/resource-registry.md](config/resource-registry.md)。

- 探查要连后端和登录的 token，由能连后端的人在自己的终端运行；每台后端一个输出目录 `local/probe/resource-classes-<站点>/`（不入库），同一台后端再探查时只请求新的瓦片集
- 只换了一种资源的配色或样式、不加分类时，不用探查：在页面上调好图例样式，用 `symbols:import` 作为默认符号发布（[commands.md](commands.md)、[modules/storage.md](modules/storage.md)"发布的默认符号"）
- 同一级别的瓦片颜色不一致时用 `--tile-check=<资源code>` 判断是不是切片把要素合并了，是的话交给切片方，前端不绕

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

### 三维的设备档位

`dist/scene-tier.json` 决定三维的瓦片缓存、每帧上传、高斯泼溅的预算用哪一档（ADR 0155、0166），逐项说明见 [config/scene-tier.md](config/scene-tier.md)。不用重新构建，用户刷新页面就生效。

```json
{ "tier": "auto" }
```

- 仓库里发布的是 `auto`（2026-11-17 起，ADR 0166）：软件渲染、集显给低档（1 GB）；独显按型号查显存表，16 GB 以上给工作站档（12 GB，淘汰到 9 GB），8 GB 以上给高档（6 GB），其余和表里没有、读不到型号的给标准档（2 GB）；浏览器给得出内存时（只有 https 下的 Chrome、Edge），内存小的再往下压。现场的 Quadro RTX 5000、RTX 4090 自动是工作站档，6 GB 显存的测试笔记本（RTX 3060 Laptop）是标准档
- 一般写 `auto`。整个现场都要同一档时才写具体的档位：`high` 要求独显、显存 8 GB 以上、内存 16 GB 以上，`workstation` 要求显存 16 GB 以上、内存 32 GB 以上、屏幕 1920×1080；写了以后弱的机器也按它，缓存超过显存不会报错、页面也不会自己降档，只是明显变慢，内存也不够时可能崩溃、降档（[config/scene-tier.md](config/scene-tier.md)"高档的要求""工作站档的要求"）。机器弱、三维常常崩溃时写 `low`；写 `standard` 就是不分设备、都按标准档
- 工作站档的数值是外推的，上线时按 `docs/backlog.md`"上线前"核对
- 文件读不到或者格式不对（包括 nginx 回退成 `index.html`）时这次按 `auto`，浏览器控制台有一条警告；不当成改了配置，各台机器记的降档不清
- 浏览器在三维崩溃后会自己降一档并提示，提示里能恢复；恢复以后同一个页面又崩时不再给恢复。这时要么改这个文件的档位（改了以后各台机器记的降档都清掉，按新的配置重新开始），要么用下面"一台机器单独设定"给那个浏览器换个档位，要么在那台机器的浏览器里只删 localStorage 的 `yzt.device.scene-tier:record` 这一个键（开发者工具 → Application → Local Storage → 这个站点）。不要用"清除站点数据"：它会一起删掉偏好的 IndexedDB（`yzt-preferences`：这个浏览器里所有账号的底图、注记、边界、资源图层、面板设置，以及按 ADR 0154 只存在这个浏览器里、还没导出的图例样式）、本浏览器的档位设定和登录会话
- `dist` 每次发布整体替换，确定下来的档位要同步回仓库的 `apps/yzt/public/scene-tier.json`，否则下次发布就还原了

**一台机器单独设定（地址栏的 `?scene-tier=`）：** 在那台机器的浏览器地址栏里给任意页面加上参数打开，例如 `http://<主机>/current-map?scene-tier=high`，没登录时先到登录页，登录后照样生效。这个浏览器记住它，以后不用再带，代替这个文件（可以比它高，也可以低）。

| 参数 | 作用 |
|---|---|
| `?scene-tier=auto` | 按显卡型号查显存（用在部署文件写了具体档位、这台机器要自动判断时） |
| `?scene-tier=low`、`standard`、`high`、`workstation` | 这个浏览器固定用这一档 |
| `?scene-tier=default` | 清掉这个浏览器的设定，回到这个文件；清掉了已有的设定时控制台有一行"清掉了本浏览器的设定（原来是 …）" |

- 只认这六个小写的值；写错了在控制台警告一次，什么都不改
- 改了设定和改这个文件一样，这台机器记的降档清掉，重新开始
- 现状底图的地址总带着这个参数，显示的是这个浏览器的设定，没有设定时是 `default`。有设定的浏览器复制、收藏的现状底图链接带着它的设定，发给别人以后对方的浏览器也会记下；没有设定的浏览器的链接带着 `default`，对方整页打开会清掉他浏览器的设定。发链接前把这个参数去掉，不要改成 `default`
- 已经开着的页面按它打开时的设定，在别的标签页改了设定以后，刷新或新开的页面才按新的
- 只在这个浏览器里：换浏览器、清除站点数据要重新设。Firefox 读不到独显的型号，`auto` 下是标准档（Intel 的集显照样认得出，是低档），要用别的档位时在 Firefox 里单独设定

**现场核对用了哪一档：** 打开现状底图，切到三维，按 F12 打开开发者工具 → Console，过滤 `[scene-tier]`，有一行定下的档位和依据，例如 `[scene-tier] 三维档位：工作站档（auto：NVIDIA Quadro RTX 5000，16 GB）`。写着"显存表里没有「…」"、引号里是真实的显卡型号（和设备管理器 → 显示适配器里的名字一致）时，是这块显卡还没列进显存表（按标准档），把名字和显存记下来，补进表（[config/scene-tier.md](config/scene-tier.md)"显存表"）；写着"浏览器不给显卡型号「…」"的是浏览器把型号藏起来了（Firefox、Safari 等），不补；各种写法见 [config/scene-tier.md](config/scene-tier.md)"控制台里定档的一行"

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

    # 可选：内网的服务器底图（ADR 0165），每套一个前缀，见上面"服务器底图单独部署"；
    # 没配的前缀回 404，不回落到 index.html。不对 .bundle、.bundlx 开 gzip
    location /basemap/ {
        return 404;
    }
    location /basemap/imagery/ {
        alias /path/to/影像缓存/Layers/;
        add_header Cache-Control "no-cache";
    }
    # standard、black、night-blue 同样写

    # 可选：禁止下载只供构建工具使用的 TTF 字体（ADR 0013）
    # location ~ ^/fonts/.*\.ttf$ {
    #     return 404;
    # }
}
```

以下规则缺一不可：

- 缺少 `try_files`：直接打开或刷新 `/current-map` 这类地址会返回 404
- 缺少 `/backend/` 转发：所有接口请求都会失败
- 缺少 `/3dt/` 的 `alias`：面板的"资源"里能列出模型，但加入后都加载失败（瓦片集的地址回退成 `index.html`）

`/basemap/` 是可选的：没有它时页面没有服务器底图，底图只有"静态底图""无底图"，其他功能不受影响（地址回退成 `index.html` 也一样，探测把它当作没有，不警告）。配了的话没配的前缀要回 404。

以上配置尚未在真实服务器上验证，首次部署时确认。

## 待补充

- 矢量瓦片的 gzip 压缩：后端不压缩瓦片，地类图斑低层级单张可达数 MB（2026-10-09 实测 z5 约 8.6 MB，z8 的一张 gzip 后为原来的 31%，见 [docs/archive/migration.md](archive/migration.md)"现状底图：接口实测"）。新项目的瓦片走同源的 `/backend/api/tiles/`，在 `/backend/` 的转发里对 `application/x-protobuf` 开启 gzip（旧项目 README 的写法：`gzip_proxied any`、`gzip_types application/x-protobuf …`）；首次部署时补充并验证
- 静态资源缓存：带哈希的 `assets/*` 可以长期缓存，`index.html` 不应缓存；`fonts/*` 每个约 5 MB、文件名带版本号，应长期缓存；`3dt/` 的模型文件不带哈希，用协商缓存。首次部署时补充
