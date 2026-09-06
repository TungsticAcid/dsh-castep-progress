/**
 * 侧边栏入口「结构查看」。
 */
import { mountSidebarEntry } from './sidebar-entry-core.ts'
import css from './viewer.module.css'
import type { PanelController } from './controller.ts'

export const ENTRY_SELECTOR = '[data-castep-structure-entry]'
const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="4" r="1.6"/><circle cx="11" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><line x1="5.3" y1="5" x2="9.7" y2="5.9"/><line x1="6.1" y1="10.7" x2="10" y2="7.1"/></svg>'

export function mountSidebarEntryRow(controller: PanelController): () => void {
  return mountSidebarEntry({
    rowAttribute: 'data-castep-structure-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'castep-structure-viewer',
    icon: ICON,
    css: css as unknown as Record<string, string>,
    label: () => '结构查看',
    tooltip: () => '查看 CASTEP 作业结构（初始→当前逐帧 + 播放）',
    onToggle: () => controller.toggle(),
    position: 'after',
    familySelectors: ['[data-castep-structure-entry]'],
    active: { subscribe: (l) => controller.subscribe(l), isOpen: () => controller.getSnapshot().panelOpen },
  })
}
