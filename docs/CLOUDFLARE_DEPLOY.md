# 部署到 Cloudflare Pages

该项目是纯静态 ES Modules 网站，推荐继续使用 Cloudflare Pages。构建脚本只把运行所需的 `index.html`、CSS、JS、正式图片和安全响应头复制到 `dist/`，不会公开测试、设计文档或开发脚本。

当前构建只发布运行时 WebP/SVG，仓库内用于再次切图和 Godot 导入的 PNG 源图不会复制到 `dist/`，避免把原始图集和任务源图一并上传。

## 当前线上链路

- GitHub：`https://github.com/TheO1dF/card-eater-playtest`
- 生产分支：`main`
- Cloudflare Pages 项目：`card-eater-playtest`
- 生产域名：`https://card-eater-playtest.pages.dev/`

带哈希前缀的地址对应一个固定部署，后续推送不会改变其内容；日常访问应使用不带哈希的生产域名。

> **Pages 必须发布 `dist/`，不能发布仓库根目录。** 根目录虽然能在线打开，但其中的 `sw.js` 是开发模板，且没有构建生成的 `asset-manifest.json`。Pages 的 SPA 回退还会让缺失的 JSON 返回首页 HTML，导致桌面浏览器看似正常、iOS/Android 安装后却无法离线启动。

`wrangler.jsonc` 已通过 `pages_build_output_dir` 声明 `dist/`。构建脚本另有 Cloudflare CI 兜底：若控制台仍错误地发布仓库根目录，会在临时构建环境中补齐带版本号的 `sw.js` 和 `asset-manifest.json`。控制台仍应按下文改成 `dist`，不要长期依赖兜底。

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

当前项目也可以直接运行 `npm run deploy`，它会构建并把 `dist/` 上传到 `card-eater-playtest`。

## 新建 Direct Upload 项目

```powershell
npx wrangler login
npx wrangler pages project create
npm run deploy
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

## 每次部署后的离线完整性检查

发布完成后运行：

```powershell
npm run verify:pwa:live
```

该命令不会只检查 HTTP 200，而会确认线上 `sw.js` 已注入构建版本、`asset-manifest.json` 确实是 JSON、两者版本一致，并逐项检查离线清单中的所有脚本、样式、卡图和道具图。Pages 把缺失文件伪装成首页 HTML 时也会直接报错。

只有检查结果的 `failures` 为空，才代表手机可以完成离线准备。修复部署后，已经安装过旧版本的手机需要联网打开主屏幕应用一次；待菜单中的“离线下载”显示就绪后，再关闭应用并打开飞行模式测试。若旧 Service Worker 仍未更新，删除主屏幕应用并重新添加一次。

官方参考：

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/build-configuration/
