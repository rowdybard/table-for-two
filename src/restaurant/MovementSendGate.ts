/** Serializes move requests within a session so HTTP responses cannot reorder input. */
export class MovementSendGate {
  private room = '';
  private pending = false;
  private serial = 0;
  private sentAt = 0;
  private moving = false;
  private horizontal = 0;
  private forward = 0;
  private deferred?: { room: string; now: number; moving: boolean; horizontal: number; forward: number; send: (complete: () => void) => void };

  begin(room: string, now: number, moving: boolean, horizontal: number, forward: number): (() => void) | undefined {
    if (room !== this.room) {
      this.room = room;
      this.pending = false;
      this.sentAt = 0;
      this.moving = false;
      this.horizontal = this.forward = 0;
      this.deferred = undefined;
      this.serial++;
    }
    if (this.pending) {
      // A new movement supersedes a queued stop if controls became active again.
      if (moving) this.deferred = undefined;
      return;
    }
    // Ignore tiny analog-stick jitter; meaningful turns and all keyboard changes
    // still send immediately, while the heartbeat carries smaller adjustments.
    const changed = moving !== this.moving || (moving && Math.hypot(horizontal - this.horizontal, forward - this.forward) >= .15);
    if (!changed && !(now - this.sentAt > 80 && (moving || this.moving))) return;
    this.pending = true;
    this.sentAt = now;
    this.moving = moving;
    this.horizontal = horizontal;
    this.forward = forward;
    const serial = ++this.serial;
    return () => {
      if (this.serial !== serial) return;
      this.pending = false;
      const next = this.deferred;
      this.deferred = undefined;
      if (next) this.submit(next.room, next.now, next.moving, next.horizontal, next.forward, next.send);
    };
  }

  /** Send or retain the latest input, even if rendering never runs another frame. */
  submit(room: string, now: number, moving: boolean, horizontal: number, forward: number, send: (complete: () => void) => void) {
    const complete = this.begin(room, now, moving, horizontal, forward);
    if (complete) send(complete);
    else if (room === this.room && this.pending) this.deferred = { room, now, moving, horizontal, forward, send };
  }

  /** Compatibility for callers that need to send or queue only a stop. */
  stop(room: string, now: number, send: (complete: () => void) => void) {
    this.submit(room, now, false, 0, 0, send);
  }
}
