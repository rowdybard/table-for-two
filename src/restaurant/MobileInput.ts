export type TouchMovement = { horizontal: number; forward: number };
type Point = { id: number; x: number; y: number };

/** Independent thumb ownership keeps a second finger from stealing or releasing a gesture. */
export class MobileInput {
  private movePoint: Point | null = null;
  private lookPoint: Point | null = null;
  private vector: TouchMovement = { horizontal: 0, forward: 0 };

  constructor(readonly radius = 44, readonly deadZone = .13) {}

  get movement(): Readonly<TouchMovement> { return this.vector; }
  get movementPointer() { return this.movePoint?.id ?? null; }
  get lookPointer() { return this.lookPoint?.id ?? null; }

  beginMove(id: number, x: number, y: number) {
    if (this.movePoint || this.lookPoint?.id === id) return false;
    this.movePoint = { id, x, y };
    this.vector = { horizontal: 0, forward: 0 };
    return true;
  }

  move(id: number, x: number, y: number) {
    if (this.movePoint?.id !== id) return false;
    const dx = (x - this.movePoint.x) / this.radius, dy = (y - this.movePoint.y) / this.radius;
    const length = Math.hypot(dx, dy);
    const strength = Math.min(1, Math.max(0, (length - this.deadZone) / (1 - this.deadZone)));
    this.vector = length ? { horizontal: dx / length * strength || 0, forward: -dy / length * strength || 0 } : { horizontal: 0, forward: 0 };
    return true;
  }

  beginLook(id: number, x: number, y: number) {
    if (this.lookPoint || this.movePoint?.id === id) return false;
    this.lookPoint = { id, x, y };
    return true;
  }

  look(id: number, x: number, y: number) {
    if (this.lookPoint?.id !== id) return null;
    // Ignore a spurious discontinuity after the OS moves a captured pointer's surface.
    const delta = { x: Math.max(-100, Math.min(100, x - this.lookPoint.x)), y: Math.max(-100, Math.min(100, y - this.lookPoint.y)) };
    this.lookPoint = { id, x, y };
    return delta;
  }

  end(id: number) {
    if (this.movePoint?.id === id) { this.movePoint = null; this.vector = { horizontal: 0, forward: 0 }; }
    if (this.lookPoint?.id === id) this.lookPoint = null;
  }

  clear() {
    this.movePoint = null; this.lookPoint = null;
    this.vector = { horizontal: 0, forward: 0 };
  }
}
