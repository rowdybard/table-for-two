/** Shared X/Z footprints. Rendered furniture and server colliders use these dimensions. */
export const RESTAURANT_BOXES = [
  { id: 'date-table', x: 0, z: -1.15, hx: .72, hz: .72 },
  { id: 'left-table', x: -3.5, z: -3.5, hx: .85, hz: .85 },
  { id: 'right-table', x: 3.5, z: -3.5, hx: .85, hz: .85 },
  { id: 'left-booth', x: -4.8, z: 1, hx: .6, hz: 2.4 },
  { id: 'right-booth', x: 4.8, z: 1, hx: .6, hz: 2.4 },
  { id: 'left-front-cafe-table', x: -3.38, z: 2.1, hx: .52, hz: .52 },
  { id: 'right-front-cafe-table', x: 3.38, z: 2.1, hx: .52, hz: .52 },
  { id: 'left-back-cafe-table', x: -3.38, z: -.15, hx: .52, hz: .52 },
  { id: 'right-back-cafe-table', x: 3.38, z: -.15, hx: .52, hz: .52 },
] as const;
