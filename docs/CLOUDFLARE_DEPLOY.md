# 部署到 Cloudflare Pages

该项目是纯静态 ES Modules 网站，推荐继续使用 Cloudflare Pages。构建脚本只把运行所需的 `index.html`、CSS、JS、正式图片和安全响应头复制到 `dist/`，不会公开测试、设计文档或开发脚本。

当前构建只发布运行时 WebP/SVG，仓库内用于再次切图和 Godot 导入的 PNG 源图不会复制到 `dist/`，避免把原始图集和任务源图一并上传。

## 当前线上链路

- GitHub：`https://github.com/TheO1dF/card-eater-game`
- 生产分支：`main`
- Cloudflare Pages 项目：`card-eater-game`
- 生产域名：`https://card-eater-game.pages.dev/`
- 已知历史部署：`https://af5057c9.card-eater-game.pages.dev/`

带哈希前缀的地址对应一个固定部署，后续推送不会改变其内容；日常访问应使用不带哈希的生产域名。当前仓库根目录仍保留可直接运行的 `index.html`，因此旧的“无构建、发布仓库根目录”配置仍能工作。若在控制台升级为显式构建配置，则使用 `npm run build` 和输出目录 `dist`。

## 找回以前的 Pages 项目

先在项目目录登录并列出账号下的 Pages 项目：

```powershell
npx wrangler login
npm run cf:projects
```

需要便于复制项目名的结构化结果时可用 `npm run cf:projects -- --json`。

找到旧项目名后执行：

```powershell
npm run build
npx wrangler pages deploy dist --project-name 你的旧项目名
```

也可以运行 `npm run deploy:pages`，Wrangler 会在缺少项目缓存时询问项目名和生产分支。

## 新建 Direct Upload 项目

```powershell
npx wrangler login
npx wrangler pages project create
npm run deploy:pages
```

部署完成后站点位于 `https://<项目名>.pages.dev`。Direct Upload 项目以后可以继续用 Wrangler 或控制台拖拽上传，但 Cloudflare 当前不支持把同一个 Direct Upload 项目直接切换成 Git Integration；若未来需要每次 Git push 自动发布，需要新建一个 Git Integration 项目。

## 连接 Git 仓库自动部署

在 Cloudflare 控制台进入 **Workers & Pages → Create application → Pages → Import an existing Git repository**，配置：

| 设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 仓库根目录 |

之后推送 `main` 会自动发布，其他分支或 Pull Request 会获得预览地址。

官方参考：

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/build-configuration/
