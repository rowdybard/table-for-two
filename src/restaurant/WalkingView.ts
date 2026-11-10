/** A bounded visual estimate; game rules and collisions still use server positions. */
export class WalkingView {
  private room = '';
  private position?: [number, number, number];

  reset() { this.room = ''; this.position = undefined; }

  sample(room: string, authoritative: [number, number, number], walking: boolean, x: number, z: number, dt: number): [number, number, number] {
    if (!walking || !room) { this.reset(); return authoritative; }
    if (room !== this.room || !this.position) {
      this.room = room;
      this.position = [...authoritative];
    }
    const p = this.position;
    const seconds = Math.max(0, Math.min(.06, dt));
    if (x || z) {
      p[0] += x * 2.8 * seconds;
      p[2] += z * 2.8 * seconds;
      // Never continue through a wall, or indefinitely outrun a slow/disconnected server.
      const dx = p[0] - authoritative[0], dz = p[2] - authoritative[2];
      const distance = Math.hypot(dx, dz), limit = .20;
      if (distance > limit) { p[0] = authoritative[0] + dx / distance * limit; p[2] = authoritative[2] + dz / distance * limit; }
    } else {
      // Let the authoritative result settle after release or a blocked control.
      const blend = 1 - Math.exp(-seconds * 12);
      p[0] += (authoritative[0] - p[0]) * blend;
      p[2] += (authoritative[2] - p[2]) * blend;
    }
    p[1] = authoritative[1];
    return [...p];
  }
}

