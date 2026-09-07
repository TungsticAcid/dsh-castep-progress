/**
 * index.ts — 结构查看器插件入口。
 * 监听进度插件派发的 'castep-open-structure' 事件，打开面板展示结构。
 *
 * ★ Node 宿主安全：DSH 会在 Node 里执行 apply()（校验/组合），
 *   所有 window/document 相关操作必须包在 typeof guard 内，
 *   否则 Node 下 window 未定义会抛错导致 dsh web 启动失败。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { PanelController } from './controller.ts'
import { mountSidebarEntryRow } from './sidebar-entry.ts'
import { mountPanel, setJob, type StructJob } from './mount.tsx'

export const inject: string[] = []
export type { StructJob }

const OPEN_STRUCTURE_EVENT = 'castep-open-structure'

export function apply(_ctx: ClientContext): void {
  const controller = new PanelController()
  const disposers: Array<() => void> = []
  // DOM 面板挂载用 try/catch：Node 里 document 未定义 → 只告警不抛出。
  try {
    disposers.push(mountSidebarEntryRow(controller))
    disposers.push(mountPanel(controller))
  } catch (e) {
    console.warn('[castep-structure-viewer] mount failed:', e)
  }

  // 事件监听只在浏览器里挂（Node 下跳过快照，避免 window is not defined）。
  if (typeof window !== 'undefined') {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as StructJob | undefined
      if (!detail) return
      setJob(detail)
      controller.openPanel()
    }
    window.addEventListener(OPEN_STRUCTURE_EVENT, onOpen)
    _ctx.effect?.(() => () => {
      window.removeEventListener(OPEN_STRUCTURE_EVENT, onOpen)
      for (const d of disposers.splice(0)) d()
    }, 'castep-structure-viewer: ui mounts')
  }
}
