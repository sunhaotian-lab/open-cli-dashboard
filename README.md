# 开放平台 CLI 实时看板

本地看板会抓取以下 3 个 GitHub 仓库页面，并展示当前的 `Stars`、`Open Issues`、`Open PRs`：

- `larksuite/cli`
- `DingTalk-Real-AI/dingtalk-workspace-cli`
- `WecomTeam/wecom-cli`

## 启动

```bash
cd /Users/haotianbot/Desktop/open-cli-dashboard
npm start
```

默认地址：

```text
http://localhost:3487
```

## Render 部署

这个项目已经包含 [render.yaml](/Users/haotianbot/Desktop/open-cli-dashboard/render.yaml)，可以直接按 Render 的 Node Web Service 方式部署。

Render 官方文档说明：

- Web Service 会得到一个固定的 `onrender.com` 子域名
- Node.js Web Service 支持用 `npm start` 作为启动命令

参考：

- [Render Web Services](https://render.com/docs/web-services)
- [Deploy a Node Express App on Render](https://render.com/docs/deploy-node-express-app)

## GitHub Pages 正式链接

这个项目也已经支持 GitHub Pages 正式发布。推到仓库 `sunhaotian-lab/open-cli-dashboard` 并把 Pages 的发布目录设成 `main /docs` 后，稳定地址会是：

```text
https://sunhaotian-lab.github.io/open-cli-dashboard/
```

发布方式：

- 运行 `npm run build:pages` 生成 `docs/`
- 推到 `main`
- 在 GitHub 仓库 `Settings -> Pages` 里选择 `Deploy from a branch`
- Branch 选 `main`，Folder 选 `/docs`

## 说明

- 服务端每 1 小时自动抓取一次 GitHub 仓库页面，并把最近 720 次快照保存到 `data/history.json`
- 页面提供一张 `Star数对比曲线`，直接对比三家累计 stars 走势
- 历史曲线数据来自 `star-history.com`
- 页面支持手动强制刷新
- 不依赖 GitHub Token，也不需要额外安装依赖
