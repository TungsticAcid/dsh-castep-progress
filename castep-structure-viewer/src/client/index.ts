/**
 * index.ts — 浏览器端(client)插件入口。
 * 向 dsh-better-sidebar 注册「结构查看」Tab（右侧面板）。
 * 由进度 Tab 通过 service.openTab({type:'castep-structure-viewer', meta:{server,job,remoteDir}}) 打开。
 */
import { createElement as h } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
/** 触发 dsh-better-sidebar 类型合并。 */
import type {} from 'dsh-better-sidebar'
import { StructureViewer } from './StructureViewer.tsx'

export const inject: string[] = ['betterSidebar']

const ICON = h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('circle', { cx: 4, cy: 4, r: 1.6 }),
  h('circle', { cx: 11, cy: 6, r: 1.6 }),
  h('circle', { cx: 6, cy: 12, r: 1.6 }),
  h('line', { x1: 5.3, y1: 5, x2: 9.7, y2: 5.9 }),
  h('line', { x1: 6.1, y1: 10.7, x2: 10, y2: 7.1 }),
)

export function apply(ctx: ClientContext): void {
  const service = (ctx as any).betterSidebar
  if (!service) return
  try {
    ctx.effect?.(() => service.registerTab({
      id: 'castep-structure-viewer',
      title: '结构查看',
      icon: ICON,
      single: true,
      order: 51,
      component: (props: { tab?: any }) => h(StructureViewer, {
        job: (props.tab?.meta as any) ?? null,
        onClose: () => service.closeTab?.(props.tab?.id),
        onBack: () => service.closeTab?.(props.tab?.id),
      }),
    }))
  } catch (e) {
    console.warn('[castep-structure-viewer] better-sidebar registerTab failed:', e)
  }
}
