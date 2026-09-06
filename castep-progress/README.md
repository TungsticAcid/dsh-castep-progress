# CASTEP 进度侧边栏插件（DSH web，@smartcatai/castep-progress）

在 DSH web 的**侧边栏**加一个「CASTEP 进度」入口，点击打开居中面板，实时展示服务器上 CASTEP 作业的进度。

- **复用现有 SSH 插件**：通过同源 `/api/dsh-ssh/exec` 走 `@linxin666/dsh-ssh`（dsh-web-all 里的 SSH 插件）的连接/凭据/持久连接池，**不自行发起连接**。
- **任务路径不写死**：优先读取智能体提交任务时写入的远程标记 `~/.smartcatai/campaigns.json`（见 SmartCatAI `src/server/campaign_marker.py`），得到每台服务器的 campaign base。**无标记时不回退**（不显示旧约定目录）。也可**在界面手动添加/删除任务路径**（持久化到 localStorage），与标记里的路径合并显示。
- **筛选**：作业名关键字 + 状态下拉（completed / running / stopped / error）。
- **排序**：点表头按 作业 / 状态 / 离子步 / SCF 步 / 能量 升降序。
- **多服务器**：顶部下拉切换 dsh-ssh 已配置主机（MS-194 / MS-211 / MS-204）。
- **刷新**：默认 **30 分钟**，可在面板里改（`刷新(min)` 输入框，自动持久化到 localStorage），并有**手动刷新**按钮。
- **点作业行 → 打开结构**：点击某行会向 `window` 派发 `castep-open-structure` 事件 `{detail:{server, job, remoteDir}}`，由**结构查看器插件**（`plugins/castep-structure-viewer`）打开并展示逐帧/动画结构。
- **只读**：只执行 `ls` / `grep` / `tail` 等只读命令，不修改服务器任何文件。

## 结构

```
plugins/castep-progress/
  package.json                 # DSH client plugin 元数据
  cordis.patch.yml             # cordis 挂载占位（无需 host 侧扩展）
  src/client/
    index.ts                   # 插件入口 apply()：挂侧边栏入口 + 居中面板
    controller.ts              # 面板开关状态
    sidebar-entry.ts           # 侧边栏入口（复用 sidebar-entry-core）
    mount.tsx                  # 居中面板（复用 panel-mount-core）
    sidebar-entry-core.ts      # 从 dsh-ssh 复制的公共核心
    panel-mount-core.ts        # 从 dsh-ssh 复制的公共核心
    panel/
      CastepProgressPanel.tsx  # 筛选/排序表格 + 30min 可调 + 手动刷新 + 读标记
      castep.module.css        # 入口 + 面板样式
```

## 安装（在 dsh-web monorepo / profile 里构建并挂载）

1. `dsh plugin --profile web add <本目录>` 或把本包放进 profile 的聚合入口。
2. 构建：
   ```sh
   pnpm install   # 装 react/react-dom peer
   pnpm --filter @smartcatai/castep-progress build   # tsdown 产出 lib/
   ```
   （或直接把 `src` 编译出 `lib/client.js`；`dsh` 的 client 加载器读取 `./client`。）
3. 重启 `dsh web`（或在 `dev:web` 下热更）。

## 依赖/前提
- 已装 `@linxin666/dsh-ssh`（dsh-web-all 全家桶）——插件用它的 `/api/dsh-ssh/exec` 与 `/api/dsh-ssh/hosts`。
- dsh-ssh 的 loopback 围栏允许**同源浏览器**访问 `/api/dsh-ssh/*`，因此在 dsh web 页面内 fetch 是通的。
- 智能体提交任务时会通过 `src/server/campaign_marker.py` 写入 `~/.smartcatai/campaigns.json`，插件据此定位任务目录。

## 说明
- 无标记且无旧约定目录时显示“暂无作业”。
- 面板与 SSH 面板互斥：打开本面板会关闭 SSH 面板（反之亦然），见 `mount.tsx` 的 `siblingPanelName`。
