/** Coalesce work that must not touch the GPU while the page is inactive. */
export class DeferredActivity {
  private active = true;
  private disposed = false;
  private readonly pending = new Set<() => void>();

  get isActive() { return this.active && !this.disposed; }
  run(work: () => void) {
    if (this.disposed) return;
    if (this.active) work(); else this.pending.add(work);
  }
  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) return;
    const pending = [...this.pending]; this.pending.clear();
    for (const work of pending) this.run(work);
  }
  dispose() { this.disposed = true; this.pending.clear(); }
}
