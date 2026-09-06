/**
 * controller.ts — 面板开关状态（简单发布/订阅）。
 */
export class PanelController {
  private open = false
  private listeners = new Set<() => void>()

  getSnapshot(): { panelOpen: boolean } { return { panelOpen: this.open } }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void { for (const l of [...this.listeners]) l() }

  toggle(): void { this.open = !this.open; this.emit() }
  openPanel(): void { this.open = true; this.emit() }
  close(): void { this.open = false; this.emit() }
}
