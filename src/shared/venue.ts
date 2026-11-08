import type { Vec3 } from './protocol';

export const VENUE = {
  width: 24,
  depth: 24,
  minX: -12, maxX: 12, minZ: -13, maxZ: 11,
  laneX: -6,
  laneStartZ: 0.5,
  pinZ: -10.5,
  playerSpeed: 4.3,
  startTime: 20 * 60 * 60,
  endTime: 24 * 60 * 60,
  storyRate: 8,
  spawn: { p1: [-.65, 0.8, 5] as Vec3, p2: [.65, 0.8, 5] as Vec3 },
};

export const DESK = { x: -4.8, z: 9.3, half: [2.4, .55, .65] as Vec3 } as const;
export const ARCADE = { centerX: 6, centerZ: -8, half: [2.4, 1.3, 1.2] as Vec3 } as const;
export const FRIENDS = { mira: [-2.2, 0, 4.6] as Vec3, dev: [2.6, 0, 1.8] as Vec3 } as const;

export const LOUNGE = {
  leftX: 2.8, rightX: 7.3, tableX: 5.05, z: 5,
  benchHalf: [.65, .6, 2.2] as Vec3,
  tableHalf: [1.2, .55, 1.4] as Vec3,
} as const;

/** Shared machine geometry and server travel limits, in venue coordinates. */
export const CLAW = {
  centerX: 8, centerZ: -3.6, cabinetHalfX: 1.25, cabinetHalfZ: 1.1, bedY: 1.5,
  minX: 7.1, maxX: 8.9, surpriseMinX: 5.7, minZ: -4.2, maxZ: -3.0,
  restY: 3.8, dropY: 2.45, hatchMaxX: 6.1, hatchMinZ: -3.2,
  initialX: 7.2, initialZ: -4.15, prizeX: 8, prizeZ: -3.6, prizeY: 1.86,
  prizeRadius: .35, giantRadius: .75, giantY: 2.9, captureRadius: .3,
} as const;

export const POOL = {
  minX: -2.7, maxX: 2.7, minZ: -7.92, maxZ: -5.08,
  centerX: 0, centerZ: -6.5, tableHalf: [3, .46, 1.7] as Vec3,
  height: .92, radius: .11, pocketRadius: .205, cushionOpening: .32, total: 6,
} as const;

export type StaticBox = { id: string; center: Vec3; half: Vec3 };
export const STATIC_BOXES: StaticBox[] = [
  { id: 'wall-back', center: [0, 2.75, VENUE.minZ], half: [VENUE.width / 2, 2.75, .3] },
  { id: 'wall-front', center: [0, 2.75, VENUE.maxZ], half: [VENUE.width / 2, 2.75, .3] },
  { id: 'wall-left', center: [VENUE.minX, 2.75, (VENUE.minZ + VENUE.maxZ) / 2], half: [.3, 2.75, VENUE.depth / 2] },
  { id: 'wall-right', center: [VENUE.maxX, 2.75, (VENUE.minZ + VENUE.maxZ) / 2], half: [.3, 2.75, VENUE.depth / 2] },
  { id: 'lane-rail-left', center: [VENUE.laneX - 2.1, .35, -6.1], half: [.16, .35, 6.7] },
  { id: 'lane-rail-right', center: [VENUE.laneX + 2.1, .35, -6.1], half: [.16, .35, 6.7] },
  { id: 'pool', center: [POOL.centerX, POOL.tableHalf[1], POOL.centerZ], half: POOL.tableHalf },
  { id: 'arcade', center: [ARCADE.centerX, ARCADE.half[1], ARCADE.centerZ], half: ARCADE.half },
  { id: 'claw', center: [CLAW.centerX, CLAW.bedY / 2, CLAW.centerZ], half: [CLAW.cabinetHalfX, CLAW.bedY / 2, CLAW.cabinetHalfZ] },
  { id: 'lounge-left', center: [LOUNGE.leftX, LOUNGE.benchHalf[1], LOUNGE.z], half: LOUNGE.benchHalf },
  { id: 'lounge-right', center: [LOUNGE.rightX, LOUNGE.benchHalf[1], LOUNGE.z], half: LOUNGE.benchHalf },
  { id: 'lounge-table', center: [LOUNGE.tableX, LOUNGE.tableHalf[1], LOUNGE.z], half: LOUNGE.tableHalf },
  { id: 'shoe-desk', center: [DESK.x, DESK.half[1], DESK.z], half: DESK.half },
];

export function nearLane(position: Vec3): boolean {
  return Math.abs(position[0] - VENUE.laneX) < 3 && position[2] > .7 && position[2] < 4.8;
}

export function nearClaw(position: Vec3): boolean {
  return Math.abs(position[0] - CLAW.centerX) < 3 && position[2] > -3 && position[2] < .6;
}

export function nearPool(position: Vec3): boolean {
  return Math.abs(position[0] - POOL.centerX) < 4 && Math.abs(position[2] - POOL.centerZ) < 2.8;
}

/** Physical lane flippers: pivot transforms are published directly in object snapshots. */
export const FLIPPERS = { pivotX: 1.45, pivotZ: -5, y: .32, halfLength: .62, halfHeight: .22, halfWidth: .14, rest: .4, active: .65, angularSpeed: 8 } as const;
