/**
 * index.ts — 结构查看器插件入口。
 * 监听进度插件派发的 'castep-open-structure' 事件，打开面板展示结构。
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
  try {
    disposers.push(mountSidebarEntryRow(controller))
    disposers.push(mountPanel(controller))
  } catch (e) { console.warn('[castep-structure-viewer] mount failed:', e) }

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
