/**
 * sidebar-entry.ts — 侧边栏入口（复用 dsh-ssh 的 sidebar-entry-core）。
 */
import { mountSidebarEntry } from './sidebar-entry-core.ts'
import type { PanelController } from './controller.ts'

export const ENTRY_SELECTOR = '[data-castep-progress-entry]'

const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h8"/><circle cx="13" cy="11.5" r="1.6"/></svg>'

export function mountSidebarEntryRow(controller: PanelController): () => void {
  return mountSidebarEntry({
    rowAttribute: 'data-castep-progress-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'castep-progress',
    icon: ICON,
    css: {} as Record<string, string>,
    label: () => 'CASTEP 进度',
    tooltip: () => '查看服务器上 CASTEP 作业的实时进度',
    onToggle: () => controller.toggle(),
    position: 'after',
    familySelectors: ['[data-castep-progress-entry]'],
    active: {
      subscribe: (l) => controller.subscribe(l),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
