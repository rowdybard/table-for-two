/** Keep a seated date and their hands in view as the viewport becomes narrow. */
export function seatedTableFieldOfView(aspect: number, sharedTable = false): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? Math.max(.35, aspect) : 1;
  // Framing width is in world units at the existing table distance (~2.4 units).
  const halfWidth = sharedTable ? 1.25 : .82;
  const fit = 2 * Math.atan(halfWidth / (2.4 * safeAspect)) * 180 / Math.PI;
  return Math.max(sharedTable ? 57 : 45, Math.min(88, fit));
}

/** Turn a little toward the shared midpoint without moving either guest from their seat. */
export function sharedTableCameraYaw(cameraX: number, distance: number): number {
  return Math.atan2(cameraX, Math.max(.5, distance));
}
