# CASTEP 进度 Tab（@smartcatai/castep-progress）

DSH web 插件：在 **dsh-better-sidebar 右侧面板**注册一个「CASTEP 进度」Tab，实时展示服务器上 CASTEP 作业的进度。

- **Appears in**: dsh-better-sidebar（右侧栏）→「+ 添加 Tab 插件」→ 添加后作为 Tab 打开。
- **复用现有 SSH 插件**：通过同源 `/api/dsh-ssh/exec` 走 `@linxin666/dsh-ssh`（dsh-web-all 里的 SSH 插件），**不自行发起连接**。
- **任务路径不写死**：优先读取智能体提交任务时写入的远程标记 `~/.smartcatai/campaigns.json`（见 SmartCatAI `src/server/campaign_marker.py`）。**无标记时不回退**（不显示旧约定目录）。也可在界面**手动添加/删除任务路径**（持久化 localStorage），与标记合并显示。
- **筛选**：作业名关键字 + 状态下拉（completed / running / stopped / error）。
- **排序**：点表头按 作业 / 状态 / 离子步 / SCF 步 / 能量 升降序。
- **多服务器**：下拉切换 dsh-ssh 已配置主机（MS-194 / MS-211 / MS-204）。
- **刷新**：默认 **30 分钟**，界面可改（`刷新(min)` 输入框，localStorage 持久化），并有**手动刷新**按钮。
- **点作业行 → 打开结构**：调用 `ctx.betterSidebar.openTab({ type:'castep-structure-viewer', meta:{server,job,remoteDir} })` 打开结构查看器 Tab。
- **只读**：只执行 `ls` / `grep` / `tail` 等只读命令。

## 实现要点
- `inject: ['betterSidebar']`（访问 `ctx.betterSidebar` 必须声明，否则 cordis 报错）。
- `apply(ctx)` 用 `ctx.effect(() => ctx.betterSidebar.registerTab({ ... component }))` 注册 Tab（返回的 disposer 由 cordis 在 fiber 释放时调用）。
- 浏览器端 client 用 **`window.__ModuleLoader__.load({ id, factory })`** 包装（DSH client-module 协议，factory 末尾 `return module.exports`）；`react/react-dom` 作为 peer 由 dsh web 提供（factory 内 `require("react")`）。
- 宿主根 `lib/index.js` 是**空壳**（Node 下 no-op，避免宿主导入浏览器端代码时引用 `window`）。

## 结构
```
castep-progress/
  package.json                # dsh.bundle + dsh.client(platform web, inject betterSidebar)
  cordis.patch.yml            # - insert: name: '@smartcatai/castep-progress'
  build.mjs                   # 单体构建入口
  lib/
    index.js                  # 宿主(Node) 空壳
    client.js                 # 浏览器端，__ModuleLoader__ 包装
  src/client/index.ts         # apply(): ctx.betterSidebar.registerTab(...)
  src/client/panel/CastepProgressPanel.tsx
```

## 构建
在 `dsh/plugins` 根目录：
```sh
npm install --no-save --legacy-peer-deps esbuild react react-dom three   # 若未装
node build-all.mjs            # 产出两个插件的 lib/client.js（CJS + __ModuleLoader__ 包装）
```
- `react/react-dom` 由 dsh web 提供（不在 bundle 内）；无 third-party 运行时依赖。
- 宿主 `lib/index.js` 为手写空壳，无需构建。

## 安装（需要 dsh-better-sidebar）
```sh
dsh plugin --profile web add <本目录绝对路径>
# 然后：restart dsh web + 硬刷新浏览器(Ctrl+Shift+R)
```
前提：已装 `@linxin666/dsh-ssh`（dsh-web-all）与 `dsh-better-sidebar`。

## 说明
- 需先 `dsh plugin add`（会写入 `dsh.profile.bundles` 与 `dependencies`）；若之后用 `dsh plugin remove` 会从 profile 移除导致“消失”。
- 无标记且无手动添加路径时显示“暂无作业”。
