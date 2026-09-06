/**
 * index.ts — 浏览器端插件入口（DSH client plugin）。
 *
 * 复用 dsh-ssh 插件：通过同源 `/api/dsh-ssh/exec` 采集 CASTEP 进度。
 * 挂载一个侧边栏入口 + 居中面板（独立插件，不改动 SSH 面板）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { PanelController } from './controller.ts'
import { mountSidebarEntryRow } from './sidebar-entry.ts'
import { mountPanel } from './mount.tsx'

/** 需要等待的服务（本插件仅用 fetch/DOM，无额外 service）。 */
export const inject: string[] = []

/** 插件入口。失败策略：只降级面板，绝不让 GUI 启动失败。 */
export function apply(_ctx: ClientContext): void {
  const controller = new PanelController()
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntryRow(controller))
    disposers.push(mountPanel(controller))
  } catch (error) {
    console.warn('[castep-progress] mount failed:', error)
  }
  _ctx.effect?.(() => () => { for (const d of disposers.splice(0)) d() }, 'castep-progress: ui mounts')
}
