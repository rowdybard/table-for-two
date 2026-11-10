/** Solo arrival follows the authoritative actor, not the visually interpolated mesh. */
export function soloDateAtSeat(position: readonly number[] | undefined, seatX: number, seatZ: number): boolean {
  return !!position && Math.hypot(position[0]! - seatX, position[2]! - seatZ) <= .15;
}

/** On the first seated frame, match the authoritative pose rather than retaining walking yaw. */
export function alignSeatedDate(
  root: { position: { set(x: number, y: number, z: number): unknown }; rotation: { y: number } },
  position: readonly number[], seated: boolean, facing: number,
): void {
  if (!seated) return;
  root.position.set(position[0]!, 0, position[2]!);
  root.rotation.y = facing;
}
