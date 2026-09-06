# CASTEP 结构查看器插件（@smartcatai/castep-structure-viewer）

DSH web **侧边栏插件**：查看 CASTEP 作业的结构，支持**从初始到当前逐帧 + 播放动画**。渲染用 three.js，思路参考 [Symmetry Viewer `H5/`](../Symmetry%20Viewer/H5)（`render/scene-builder.js` 的球棍/晶体渲染）。

## 触发方式
- 自己在侧边栏点「结构查看」打开空面板。
- 在 **CASTEP 进度插件**里点击某个作业行，进度插件会派发 `window` 上的 `castep-open-structure` 事件：
  ```js
  { detail: { server, job, remoteDir } }
  ```
  本插件监听该事件 → 记录任务 → 打开面板并加载结构。

## 数据来源 / 结构解析
- 复用 `@linxin666/dsh-ssh` 的同源 `/api/dsh-ssh/exec`，在 `remoteDir` 里读取：
  - `<job>.geom`：CASTEP 几何轨迹（含初始→当前每一帧的晶格 + 原子坐标）。
  - 若没有 `.geom`，回退读 `<job>.cell`（单帧初始结构）。
- 解析 `%BLOCK LATTICE_CART` + `%BLOCK POSITIONS_FRAC/ABS`（重复出现的帧），分数坐标→笛卡尔，得到 `frames[]`。
- 渲染：原子球（元素近似 CPK 颜色）+ 晶胞框（`LineSegments`）+ 帧滑块 + 播放/暂停（>=2 帧）。

## 结构
```
plugins/castep-structure-viewer/
  package.json
  cordis.patch.yml
  src/client/
    index.ts                    # apply：监听事件 + 挂侧边栏入口/面板
    controller.ts               # 面板开关
    sidebar-entry.ts            # 侧边栏入口（复用 sidebar-entry-core）
    mount.tsx                   # 居中面板 + setJob() 重渲染
    sidebar-entry-core.ts       # 从 dsh-ssh 复制的公共核心
    panel-mount-core.ts         # 从 dsh-ssh 复制的公共核心
    StructureViewer.tsx         # three.js 渲染 + 逐帧/动画
    viewer.module.css
```

## 安装
与进度插件一致：`dsh plugin --profile web add <本目录>` → 构建（`pnpm --filter @smartcatai/castep-structure-viewer build`）→ 重启 `dsh web`。

## 依赖/前提
- 已装 `@linxin666/dsh-ssh`（用其 `/api/dsh-ssh/exec`）。
- `three`（已在 package.json dependencies）。
- 与「CASTEP 进度」插件配合：进度插件点击作业行会派发 `castep-open-structure`。

## 说明
- 结构解析/渲染为 three.js 版本，未做原子拾取/标签等高级功能；如需要可再借鉴 Symmetry Viewer 的 `scene-builder.js`（球棍/CPK/晶胞）与 `viewer.js` 交互。
- 只读，不修改服务器文件。
