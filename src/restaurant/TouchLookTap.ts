type TapCandidate = { id: number; x: number; y: number; at: number; moved: boolean };

/** A short, single-finger look-pad gesture can inspect what was touched. */
export class TouchLookTap {
  private candidate: TapCandidate | null = null;
  private readonly active = new Set<number>();

  pointerDown(id: number) {
    this.active.add(id);
    if (this.active.size > 1) this.cancel();
  }
  pointerUp(id: number) { this.active.delete(id); }
  reset() { this.cancel(); this.active.clear(); }

  begin(id: number, x: number, y: number, at: number) {
    if (this.active.size !== 1 || !this.active.has(id)) return;
    this.candidate = { id, x, y, at, moved: false };
  }

  move(id: number, x: number, y: number) {
    const tap = this.candidate;
    if (tap?.id === id && Math.hypot(x - tap.x, y - tap.y) >= 8) tap.moved = true;
  }

  end(id: number, x: number, y: number, at: number) {
    const tap = this.candidate;
    if (!tap || tap.id !== id) return false;
    this.candidate = null;
    return !tap.moved && at >= tap.at && at - tap.at < 350 && Math.hypot(x - tap.x, y - tap.y) < 8;
  }

  cancel() { this.candidate = null; }
}
