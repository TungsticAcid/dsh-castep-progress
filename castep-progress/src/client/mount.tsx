/**
 * mount.tsx — 把 CASTEP 进度面板挂到居中列（复用 dsh-ssh 的 panel-mount-core）。
 */
import { mountCenterPanel } from './panel-mount-core.ts'
import { CastepProgressPanel } from './panel/CastepProgressPanel.tsx'
import type { PanelController } from './controller.ts'

export function mountPanel(controller: PanelController): () => void {
  return mountCenterPanel({
    render: (root) => root.render(
      <CastepProgressPanel onClose={() => controller.close()} />,
    ),
    viewDatasetKey: 'castepProgressView',
    pluginName: 'castep-progress',
    viewClassName: "",
    activeAttribute: 'data-castep-progress-active',
    siblingActiveAttribute: 'data-dsh-ssh-active',
    panelName: 'castep-progress',
    siblingPanelName: 'ssh',
    isOpen: () => controller.getSnapshot().panelOpen,
    close: () => controller.close(),
    subscribe: (l) => controller.subscribe(l),
  })
}
