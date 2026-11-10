/** Combines visibility, focus and page-cache signals into one idempotent lifecycle. */
export class PageActivity {
  private hidden = false;
  private blurred = false;
  private pageHidden = false;
  private active = true;
  constructor(private readonly suspend: () => void, private readonly resume: () => void) {}
  visibility(hidden: boolean) { this.hidden = hidden; this.update(); }
  focus(focused: boolean) { this.blurred = !focused; this.update(); }
  page(visible: boolean) { this.pageHidden = !visible; this.update(); }
  private update() {
    const active = !this.hidden && !this.blurred && !this.pageHidden;
    if (active === this.active) return;
    this.active = active;
    if (active) this.resume(); else this.suspend();
  }
}
