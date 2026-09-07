/**
 * index.ts — 浏览器端插件入口（DSH client plugin）。
 * 向 dsh-better-sidebar 注册一个「CASTEP 进度」Tab（出现在右侧面板），
 * 复用 @linxin666/dsh-ssh 的同源接口采集数据。
 * Node 组合阶段：apply 会被调用，但 betterSidebar 可能无浏览器 DOM；
 * 我们用可选链 + try/catch 保证 Node 下不抛错、浏览器下正常挂载。
 */
import { createElement as h } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { CastepProgressPanel } from './panel/CastepProgressPanel.tsx'

/** 需要等待的服务（better-sidebar 提供右侧面板槽位）。 */
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
    service.registerTab({
      id: 'castep-progress',
      title: 'CASTEP 进度',
      icon: ICON,
      single: true,
      order: 50,
      component: (props: { visible: boolean }) => h(CastepProgressPanel, {
        onOpenStructure: (job: JobRef) => {
          service.openTab({ type: 'castep-structure-viewer', title: job.job, meta: job })
        },
      }),
    })
  } catch (e) {
    console.warn('[castep-progress] better-sidebar registerTab failed:', e)
  }
}
