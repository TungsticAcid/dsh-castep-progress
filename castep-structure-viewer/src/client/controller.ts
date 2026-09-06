export class PanelController {
  private open = false
  private listeners = new Set<() => void>()
  getSnapshot() { return { panelOpen: this.open } }
  subscribe(l: () => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l) }
  private emit() { for (const l of [...this.listeners]) l() }
  toggle() { this.open = !this.open; this.emit() }
  openPanel() { this.open = true; this.emit() }
  close() { this.open = false; this.emit() }
}
