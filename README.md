# SmartCatAI DSH Plugins（dsh-castep-progress）

DSH web 的两个侧边栏插件（**dsh-better-sidebar 右侧面板 Tab**），用于监控与查看 CASTEP 计算。

- [`castep-progress/`](./castep-progress) —— CASTEP 作业进度 Tab（筛选/排序、路径管理、30min 可调/手动刷新、多服务器、点作业打开结构）。
- [`castep-structure-viewer/`](./castep-structure-viewer) —— CASTEP 结构查看 Tab（`lib/client.js` 内嵌 three.js；从 `.geom` 解析逐帧 + 播放动画；无 `.geom` 回退 `.cell` 单帧）。

## 如何工作
- 两个插件都向 **`ctx.betterSidebar`** 注册 Tab（`inject: ['betterSidebar']`，`ctx.effect(() => registerTab(...))`），因此出现在 dsh-better-sidebar 右侧面板；进度 Tab 点作业行 → `service.openTab({ type:'castep-structure-viewer', meta })` 打开结构 Tab。
- 数据复用 **`@linxin666/dsh-ssh`** 的同源 `/api/dsh-ssh/exec` 与 `/api/dsh-ssh/hosts`（读取 `~/xjl/smartcatai_campaign` 或智能体写下的 `~/.smartcatai/campaigns.json`）。
- 浏览器端 client 用 **`window.__ModuleLoader__.load({ id, factory })`** 包装（DSH client-module 协议）；宿主根 `lib/index.js` 为空壳。

## 构建
在 `dsh/plugins` 根：
```sh
npm install --no-save --legacy-peer-deps esbuild react react-dom three   # 一次性
node build-all.mjs    # 产出 castep-progress/lib/client.js 与 castep-structure-viewer/lib/client.js
```
- `react/react-dom` 由 dsh web 提供（作为 peer，不在 bundle）；`three` 打进结构查看器 client。
- 宿主 `lib/index.js` 为手写空壳（无需构建）。

## 安装（需先装 dsh-better-sidebar 与 @linxin666/dsh-ssh）
```sh
dsh plugin --profile web add D:/xjl/program/dsh/plugins/castep-progress
dsh plugin --profile web add D:/xjl/program/dsh/plugins/castep-structure-viewer
# 然后 restart dsh web + 硬刷新浏览器(Ctrl+Shift+R)
```

## 许可 / 致谢
- 本仓库 Apache-2.0（见 `LICENSE`）。
- 致谢：`@linxin666/dsh-ssh`、`dsh-better-sidebar`、`three.js`、Symmetry Viewer（见 `NOTICE`）。

## 说明
- 装好后会写入 `~/.dsh/profiles/web` 的 `package.json`（`dependencies` + `dsh.profile.bundles`）；若 `dsh plugin remove` 会从 profile 移除，插件入口即“消失”。
- 仓库为**源码包**，`lib/` 不入库（安装/构建后于本地产出）。
