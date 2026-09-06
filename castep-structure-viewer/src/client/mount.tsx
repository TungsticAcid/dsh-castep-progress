/**
 * mount.tsx — 把结构查看面板挂到居中列，并可重渲染当前任务。
 */
import { mountCenterPanel } from './panel-mount-core.ts'
import { StructureViewer, type StructJob } from './StructureViewer.tsx'
import type { PanelController } from './controller.ts'

export type { StructJob }

let root: any = null
let currentJob: StructJob | null = null

function render() {
  root?.render(
    <StructureViewer
      job={currentJob ?? { server: '', job: '', remoteDir: '' }}
      onClose={() => currentController?.close()}
      onBack={() => currentController?.close()}
    />,
  )
}

let currentController: PanelController | null = null

export function setJob(job: StructJob): void {
  currentJob = job
  render()
}

export function mountPanel(controller: PanelController): () => void {
  currentController = controller
  return mountCenterPanel({
    render: (r) => { root = r; render() },
    viewDatasetKey: 'castepStructureView',
    pluginName: 'castep-structure-viewer',
    viewClassName: "",
    activeAttribute: 'data-castep-structure-active',
    siblingActiveAttribute: 'data-dsh-ssh-active',
    panelName: 'castep-structure-viewer',
    siblingPanelName: 'ssh',
    isOpen: () => controller.getSnapshot().panelOpen,
    close: () => controller.close(),
    subscribe: (l) => controller.subscribe(l),
  })
}
