type Finger = { id: number; x: number; y: number; dragged: boolean };

/** A button tap must survive suppressed compatibility clicks after a canceled canvas drag. */
export class TouchButtonGesture {
  private finger: Finger | null = null;
  private readonly ended = new Map<number, number>();

  constructor(private readonly slop = 14, private readonly compatibilityWindowMs = 1000) {}

  begin(id: number, x: number, y: number) {
    if (this.finger) return false;
    this.finger = { id, x, y, dragged: false };
    return true;
  }

  move(id: number, x: number, y: number) {
    if (this.finger?.id !== id) return;
    if (Math.hypot(x - this.finger.x, y - this.finger.y) > this.slop) this.finger.dragged = true;
  }

  end(id: number, x: number, y: number, inside: boolean, now: number) {
    // Even a canceled/unowned touch must not become a late native click.
    this.rememberEnd(id, now);
    if (this.finger?.id !== id) return false;
    const finger = this.finger;
    this.finger = null;
    return inside && !finger.dragged && Math.hypot(x - finger.x, y - finger.y) <= this.slop;
  }

  cancel(id?: number, now?: number) {
    if (this.finger && (id === undefined || this.finger.id === id)) {
      if (now !== undefined) this.rememberEnd(this.finger.id, now);
      this.finger = null;
    }
  }

  ignoreClick(detail: number, pointerType: string | undefined, pointerId: number | undefined, now: number, firesTouchEvents?: boolean) {
    // Native keyboard / assistive activation has detail 0; real mice keep their click path.
    if (detail === 0 || pointerType === 'mouse' || pointerType === 'pen' || firesTouchEvents === false) return false;
    this.expire(now);
    const at = pointerType === 'touch' && pointerId !== undefined ? this.ended.get(pointerId) : Math.max(-Infinity, ...this.ended.values());
    return at !== undefined && now >= at && now - at <= this.compatibilityWindowMs;
  }

  private rememberEnd(id: number, now: number) {
    this.expire(now);
    this.ended.set(id, now);
  }

  private expire(now: number) {
    for (const [id, at] of this.ended) if (now - at > this.compatibilityWindowMs) this.ended.delete(id);
  }
}
