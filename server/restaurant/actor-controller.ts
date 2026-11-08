import RAPIER from '@dimforge/rapier3d-compat';

/** Seated actors belong to their chair controller, rather than collision impulses. */
export function setActorSeated(body: RAPIER.RigidBody, seated: boolean, position?: { x: number; y: number; z: number }) {
  const type = seated ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic;
  if (body.bodyType() !== type) body.setBodyType(type, true);
  if (seated && position) body.setNextKinematicTranslation(position);
}
