# 部署要求

发布流程（版本号、CHANGELOG、CD）在首次部署前另写 ADR 决定（ADR 0005）。本文记录前端对服务器的要求。

## 构建产物

`pnpm build` 后，`apps/web/dist/` 是纯静态文件，由 nginx 等静态服务器提供。

### 构建前放入字体

普惠体的字体文件按授权不能提交到公开仓库（ADR 0012），所以仓库和 CI 中都没有。用于部署的构建，要在构建前把两个 WOFF2 放进 `apps/web/public/fonts/`（文件名和来源见 [design/fonts.md](design/fonts.md)），构建时会被复制到 `dist/fonts/`。

构建完成后检查 `dist/fonts/` 下有 `AlibabaPuHuiTi-3-55-Regular.woff2` 和 `AlibabaPuHuiTi-3-75-SemiBold.woff2`。缺少时页面仍能正常使用，但正文会显示为微软雅黑。

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

    # 页面：history 模式下，未知路径回退到 index.html，由前端路由处理（ADR 0007）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

两条规则缺一不可：

- 缺少 `try_files`：直接打开或刷新 `/current-map` 这类地址会返回 404
- 缺少 `/backend/` 转发：所有接口请求都会失败

以上配置尚未在真实服务器上验证，首次部署时确认。

## 待补充

- 矢量瓦片的 gzip 压缩：旧项目 README 记录了瓦片经 nginx 同源转发并开启 gzip 的配置，迁移地图模块时补充
- 静态资源缓存：带哈希的 `assets/*` 可以长期缓存，`index.html` 不应缓存；`fonts/*` 每个约 5 MB、文件名带版本号，应长期缓存。首次部署时补充
