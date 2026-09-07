# CASTEP 结构查看器 Tab（@smartcatai/castep-structure-viewer）

DSH web 插件：在 **dsh-better-sidebar 右侧面板**注册「结构查看」Tab，用于查看 CASTEP 作业结构，支持**从初始到当前逐帧 + 播放动画**。渲染用 three.js，思路参考 [Symmetry Viewer `H5/`](../Symmetry%20Viewer/H5)。

## 触发
- **常规**：在「CASTEP 进度」Tab 里点某个作业行 → 进度插件调用
  ```js
  ctx.betterSidebar.openTab({ type: 'castep-structure-viewer', title: job, meta: { server, job, remoteDir } })
  ```
  本 Tab 从 `tab.meta` 读取作业并加载结构。
- **直接打开**：从「+ 添加 Tab 插件」打开该 Tab；若尚无 `meta` 会显示占位提示，先去进度 Tab 点一个作业。

## 数据来源 / 结构解析
- 复用 `@linxin666/dsh-ssh` 的同源 `/api/dsh-ssh/exec`：
  - `<job>.geom`：CASTEP 几何轨迹（含初始→当前每一帧的晶格 + 原子坐标）。
  - 若无 `.geom`，回退读 `<job>.cell`（单帧初始结构）。
- 解析 `%BLOCK LATTICE_CART` + `%BLOCK POSITIONS_FRAC/ABS`（重复帧→分数坐标→笛卡尔），得 `frames[]`。
- 渲染：原子球（近似 CPK 颜色，可切换自定义颜色）+ 晶胞框（LineSegments）+ 帧滑块 + 播放/暂停（≥2 帧）。相机支持**自由平移/旋转/缩放**（拖动=旋转、Shift+拖动=平移、滚轮=缩放），背景色可调；用无光照 MeshBasicMaterial 保证颜色可见。

## 实现要点
- `inject: ['betterSidebar']`；`apply` 用 `ctx.effect(() => ctx.betterSidebar.registerTab({ ... component }))`。
- 客户端 `lib/client.js` 由 `build-all.mjs` 产出：esbuild CJS → **`window.__ModuleLoader__.load({ id, factory })`** 包装，factory 末尾 `return module.exports`。
- **`three` 打进 bundle**；`react/react-dom` 作为 peer 由 dsh web 提供（避免双 React）。
- 宿主根 `lib/index.js` 为空壳（Node 下 no-op）。

## 结构
```
castep-structure-viewer/
  package.json
  cordis.patch.yml
  build.mjs
  lib/
    index.js                  # 宿主(Node) 空壳
    client.js                 # 浏览器端，__ModuleLoader__ 包装（含 three）
  src/client/index.ts         # apply(): ctx.betterSidebar.registerTab(...)
  src/client/StructureViewer.tsx
```

## 构建 / 安装
同进度插件：在 `dsh/plugins` 根 `node build-all.mjs` → `dsh plugin --profile web add <本目录绝对路径>` → 重启 `dsh web` + 硬刷新浏览器。前提：已装 `@linxin666/dsh-ssh` 与 `dsh-better-sidebar`。

## 依赖/前提
- `@linxin666/dsh-ssh`（用 `/api/dsh-ssh/exec`）。
- `three`（作为 dependency 打进 bundle）。
- `dsh-better-sidebar`（提供右侧面板与 `ctx.betterSidebar` 服务）。

## 说明
- 未做原子拾取/标签等高级功能；如需要可再借鉴 Symmetry Viewer 的 `scene-builder.js`（球棍/CPK/晶胞）与 `viewer.js` 交互。
- 只读，不修改服务器文件。
