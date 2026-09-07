/**
 * index.ts — 浏览器端(client)插件入口。
 * 向 dsh-better-sidebar 注册「CASTEP 进度」Tab（右侧面板）。
 * ★ 必须用 ctx.effect 包裹 registerTab（返回的 disposer 由 cordis 在 fiber 释放时自动调用）。
 */
import { createElement as h } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
/** 触发 dsh-better-sidebar 的类型合并（运行时无副作用）。 */
import type {} from 'dsh-better-sidebar'
import { CastepProgressPanel } from './panel/CastepProgressPanel.tsx'

export const inject: string[] = ['betterSidebar']

const ICON = h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('path', { d: 'M2 4.5h12M2 8h12M2 11.5h8' }),
  h('circle', { cx: 13, cy: 11.5, r: 1.6 }),
)

interface JobRef { server: string; job: string; remoteDir: string }

export function apply(ctx: ClientContext): void {
  const service = (ctx as any).betterSidebar
  if (!service) return
  try {
    ctx.effect?.(() => service.registerTab({
      id: 'castep-progress',
      title: 'CASTEP 进度',
      icon: ICON,
      single: true,
      order: 50,
      component: () => h(CastepProgressPanel, {
        onOpenStructure: (job: JobRef) => {
          service.openTab({ type: 'castep-structure-viewer', title: job.job, meta: job })
        },
      }),
    }))
  } catch (e) {
    console.warn('[castep-progress] better-sidebar registerTab failed:', e)
  }
}
