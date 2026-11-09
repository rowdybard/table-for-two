/** Holds the local date's attention on the player during the approach to their chair. */
export class SeatingSpeechFacing {
  private room = '';
  private humanWasSeated = false;
  private approaching = false;
  private claimed = false;

  update(room: string, humanSeated: boolean, dateSeated: boolean, localSpeaking: boolean, available: boolean) {
    if (room !== this.room) {
      this.room = room;
      this.humanWasSeated = this.approaching = this.claimed = false;
    }
    if (!humanSeated || !available) {
      this.humanWasSeated = this.approaching = this.claimed = false;
      return false;
    }
    if (!this.humanWasSeated) this.approaching = true;
    this.humanWasSeated = true;
    if (this.approaching && localSpeaking) this.claimed = true;
    const facePlayer = this.approaching && this.claimed;
    // Include the arrival frame, then return ordinary seated posing to the renderer.
    if (dateSeated) this.approaching = this.claimed = false;
    return facePlayer;
  }
}

/** A direct yaw avoids spending several slow frames turning while a line is delivered. */
export function facingPlayerYaw(dateX: number, dateZ: number, playerX: number, playerZ: number) {
  return Math.atan2(playerX - dateX, playerZ - dateZ);
}
