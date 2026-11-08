import type { ClientMessage, PlayerId, RoomState, ServerMessage, VoiceSignal } from '../shared/protocol';

export type VoiceStatus = {
  enabled: boolean;
  muted: boolean;
  phase: 'off' | 'requesting' | 'waiting' | 'connecting' | 'connected' | 'paused' | 'error';
  message: string;
  playbackBlocked: boolean;
};
type SignalMessage = Extract<ServerMessage, { type: 'voice-signal' }>;
export type VoiceRoomSnapshot = Pick<RoomState, 'room' | 'phase' | 'pauseReason' | 'voice'> & { players: { id: PlayerId; connected: boolean }[] };
type Options = {
  send: (message: ClientMessage) => void; audio: HTMLAudioElement; onStatus: (status: VoiceStatus) => void;
  capture?: () => Promise<MediaStream>; releaseCapture?: (stream: MediaStream) => void;
  iceServers?: () => RTCIceServer[]; partnerLabel?: string;
};

const REQUEST_TIMEOUT_MS = 60_000;
const ACK_TIMEOUT_MS = 15_000;
const PARTNER_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 20_000;
const DISCONNECT_TIMEOUT_MS = 10_000;

/** Two-person voice transport. The server owns consent, room state, and signaling epochs. */
export class VoiceChat {
  private readonly send: Options['send'];
  private readonly audio: HTMLAudioElement;
  private readonly onStatus: Options['onStatus'];
  private snapshot?: VoiceRoomSnapshot;
  private localId?: PlayerId;
  private stream?: MediaStream;
  private peer?: RTCPeerConnection;
  private peerEpoch = -1;
  private peerSerial = 0;
  private generation = 0;
  private intended = false;
  private requesting = false;
  private announced = false;
  private awaitingAck = false;
  private ackObserved = false;
  private muted = false;
  private playbackBlocked = false;
  private playbackAttempt = 0;
  private signalChain: Promise<void> = Promise.resolve();
  private queuedCandidates: RTCIceCandidateInit[] = [];
  private requestTimer?: ReturnType<typeof setTimeout>;
  private ackTimer?: ReturnType<typeof setTimeout>;
  private partnerTimer?: ReturnType<typeof setTimeout>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private lastStatus = '';
  private phase: VoiceStatus['phase'] = 'off';
  private message = 'Voice is off.';
  private readonly capture?: Options['capture'];
  private readonly releaseCapture?: Options['releaseCapture'];
  private readonly iceServers?: Options['iceServers'];
  private readonly partnerLabel: string;

  constructor({ send, audio, onStatus, capture, releaseCapture, iceServers, partnerLabel = 'your date' }: Options) {
    this.send = send; this.audio = audio; this.onStatus = onStatus;
    this.capture = capture; this.releaseCapture = releaseCapture; this.iceServers = iceServers; this.partnerLabel = partnerLabel;
    this.audio.autoplay = false;
    this.audio.setAttribute('playsinline', '');
    this.publish('off', 'Voice is off.');
  }

  /** Capture starts only in response to the person's explicit Enable voice action. */
  async enable(): Promise<void> {
    if (this.disposed || this.requesting || this.intended) return;
    if (!this.canRequest()) { this.publish('error', 'Voice can be enabled when both people are connected and the evening is playing.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { this.publish('error', 'This browser cannot access a microphone here.'); return; }
    const token = ++this.generation;
    this.intended = true; this.requesting = true; this.announced = false; this.awaitingAck = false; this.ackObserved = false; this.playbackBlocked = false;
    this.publish('requesting', 'Waiting for microphone permission…');
    this.requestTimer = setTimeout(() => {
      if (token === this.generation && this.requesting) this.fail('Microphone permission timed out. Enable voice to try again.');
    }, REQUEST_TIMEOUT_MS);
    let capture: MediaStream;
    try {
      capture = this.capture ? await this.capture() : await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      if (token !== this.generation || this.disposed) return;
      this.fail('Microphone access was not available or was declined. Enable voice to try again.');
      return;
    }
    // Disable every track synchronously before any signaling or other asynchronous work.
    for (const track of capture.getTracks()) track.enabled = false;
    if (token !== this.generation || this.disposed || !this.intended || !this.canRequest()) {
      this.releaseStream(capture);
      if (token === this.generation && this.intended) this.fail('The room changed before voice was enabled. Please try again.');
      return;
    }
    const tracks = capture.getAudioTracks();
    if (!tracks.length || tracks.every(track => track.readyState === 'ended')) { this.releaseStream(capture); this.fail('No microphone audio track was available.'); return; }
    for (const track of capture.getVideoTracks()) track.stop();
    this.clearRequestTimer(); this.requesting = false; this.stream = capture;
    for (const track of tracks) track.onended = () => {
      if (token === this.generation && this.stream === capture && this.intended) this.fail('The microphone stopped. Enable voice to try again.');
    };
    // Snapshots already in flight may still show false; only a true acknowledgement ends this grace period.
    this.awaitingAck = true; this.announced = true;
    this.ackTimer = setTimeout(() => {
      if (token === this.generation && this.awaitingAck) this.fail('Voice could not be enabled in the room. Please try again.');
    }, ACK_TIMEOUT_MS);
    this.publish('waiting', 'Microphone ready. Waiting for the room…');
    try { this.send({ type: 'voice-enable', enabled: true }); }
    catch { this.fail('Voice could not reach the room. Please try again.'); }
  }

  /** Turning voice off releases the microphone, unlike muting. */
  disable(notifyServer = true): void {
    if (this.disposed) return;
    this.teardown(notifyServer);
    this.publish('off', 'Voice is off.');
  }

  update(state: VoiceRoomSnapshot, localId: PlayerId): void {
    if (this.disposed) return;
    // A new room or identity must never inherit a previous microphone grant.
    if (this.snapshot && (this.snapshot.room !== state.room || (this.localId && this.localId !== localId))) this.teardown(false);
    const previous = this.snapshot;
    // An older snapshot must not tear down a newer signaling epoch.
    if (previous && previous.room === state.room && state.voice.epoch < previous.voice.epoch && state.phase !== 'ended') return;
    this.snapshot = state; this.localId = localId;
    if (state.phase === 'ended') { if (this.intended || this.stream || this.requesting) this.teardown(false); this.publish('off', 'Voice ended with the session.'); return; }
    if (state.pauseReason === 'reconnect' || ((this.intended || !!this.stream || this.requesting) && (state.players.length !== 2 || state.players.some(p => !p.connected)))) {
      if (this.intended || this.stream || this.requesting) this.teardown(false);
      this.publish('off', 'Connection interrupted. Enable voice again after reconnecting.'); return;
    }
    if (this.requesting && state.phase !== 'playing') {
      this.teardown(false); this.publish('off', 'The room paused before voice was enabled.'); return;
    }
    if (!this.intended || !this.stream) return;
    if (this.awaitingAck && state.voice.enabled[localId]) {
      this.awaitingAck = false; this.ackObserved = true; this.clearAckTimer();
    } else if (this.ackObserved && !state.voice.enabled[localId]) {
      this.teardown(false); this.publish('off', 'Voice was turned off in the room.'); return;
    }
    this.reconcile();
  }

  /** Signals are serialized so candidates cannot overtake remote-description setup. */
  async handleSignal(message: SignalMessage): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    this.signalChain = this.signalChain.then(async () => {
      if (generation !== this.generation || !this.validSignal(message)) return;
      this.reconcile();
      const pc = this.peer, serial = this.peerSerial;
      if (!pc || this.peerEpoch !== message.epoch) return;
      const valid = () => this.validPeer(pc, serial, generation) && this.peerEpoch === message.epoch;
      try {
        const signal = message.signal;
        if (signal.kind === 'candidate') {
          if (!pc.remoteDescription) { this.queuedCandidates.push(signal.candidate); return; }
          await pc.addIceCandidate(signal.candidate);
          if (!valid()) return;
        } else {
          const type = signal.description.type;
          if ((type === 'offer' && this.localId !== 'p2') || (type === 'answer' && this.localId !== 'p1')) return;
          if ((type === 'offer' && pc.signalingState !== 'stable') || (type === 'answer' && pc.signalingState !== 'have-local-offer')) return;
          await pc.setRemoteDescription(signal.description);
          if (!valid()) return;
          const candidates = this.queuedCandidates.splice(0);
          for (const candidate of candidates) { await pc.addIceCandidate(candidate); if (!valid()) return; }
          if (type === 'offer') {
            const answer = await pc.createAnswer(); if (!valid()) return;
            await pc.setLocalDescription(answer); if (!valid()) return;
            this.sendDescription(pc, 'answer');
          }
        }
      } catch {
        if (valid()) this.fail('The voice connection could not be established. Enable voice to try again.');
      }
    }).catch(() => { /* A prior canceled signal must not poison later epochs. */ });
    await this.signalChain;
  }

  toggleMute(): void {
    if (this.disposed || !this.intended || !this.stream) return;
    this.muted = !this.muted; this.syncMedia();
    if (this.canTransmit()) this.publish('connected', this.muted ? 'Voice connected. Your microphone is muted.' : 'Voice connected.');
    else this.publishCurrent();
  }
  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.audio.volume = Math.max(0, Math.min(1, value));
  }
  async playRemote(): Promise<void> {
    if (this.disposed || !this.canTransmit() || !this.audio.srcObject) return;
    const attempt = ++this.playbackAttempt, token = this.generation, serial = this.peerSerial, source = this.audio.srcObject;
    try {
      await this.audio.play();
      if (attempt !== this.playbackAttempt || token !== this.generation || serial !== this.peerSerial || !this.canTransmit()) { if (this.audio.srcObject === source && !this.canTransmit()) this.audio.pause(); return; }
      this.playbackBlocked = false; this.publishCurrent();
    } catch {
      if (attempt !== this.playbackAttempt || token !== this.generation || serial !== this.peerSerial || !this.canTransmit()) return;
      this.playbackBlocked = true; this.publishCurrent();
    }
  }

  /** Call immediately when the socket is lost: reconnect always requires a fresh opt-in. */
  disconnect(): void {
    if (this.disposed) return;
    this.teardown(false); this.snapshot = undefined; this.localId = undefined;
    this.publish('off', 'Connection interrupted. Enable voice again after reconnecting.');
  }
  dispose(): void {
    if (this.disposed) return;
    this.teardown(true); this.snapshot = undefined; this.localId = undefined; this.disposed = true;
  }

  private canRequest(): boolean {
    const s = this.snapshot;
    return !!s && !!this.localId && s.phase === 'playing' && s.players.length === 2 && s.players.every(p => p.connected);
  }
  private eligible(): boolean {
    const s = this.snapshot;
    return !!s && !!this.localId && this.intended && !!this.stream && !this.awaitingAck && s.phase === 'playing' && s.players.length === 2 && s.players.every(p => p.connected) && s.voice.enabled.p1 && s.voice.enabled.p2;
  }
  private canTransmit(): boolean { return this.eligible() && !!this.peer && this.peer.connectionState === 'connected' && this.peerEpoch === this.snapshot?.voice.epoch; }
  private validSignal(message: SignalMessage): boolean {
    return !!this.snapshot && !!this.localId && this.eligible() && message.epoch === this.snapshot.voice.epoch && message.from !== this.localId;
  }
  private validPeer(peer: RTCPeerConnection, serial: number, generation: number): boolean {
    return !this.disposed && this.generation === generation && this.peer === peer && this.peerSerial === serial && this.eligible() && this.peerEpoch === this.snapshot?.voice.epoch;
  }
  private reconcile(): void {
    const s = this.snapshot, id = this.localId;
    if (!s || !id || !this.intended || !this.stream) return;
    if (this.peer && (this.peerEpoch !== s.voice.epoch || !this.eligible())) this.closePeer();
    if (this.awaitingAck) { this.syncMedia(); this.publish('waiting', 'Microphone ready. Waiting for the room…'); return; }
    if (s.phase === 'paused') {
      this.clearPartnerTimer(); this.syncMedia(); this.publish('paused', 'Voice is paused with the evening.'); return;
    }
    if (!this.eligible()) {
      this.syncMedia(); this.startPartnerTimer(); this.publish('waiting', `Waiting for ${this.partnerLabel} to enable voice.`); return;
    }
    this.clearPartnerTimer();
    if (!this.peer) this.startPeer(s.voice.epoch);
    if (!this.intended || !this.stream) return;
    this.syncMedia();
    if (this.peer?.connectionState === 'connected') this.publish('connected', this.muted ? 'Voice connected. Your microphone is muted.' : 'Voice connected.');
    else this.publish('connecting', 'Connecting voice…');
  }
  private startPeer(epoch: number): void {
    const generation = this.generation;
    let pc: RTCPeerConnection;
    try { pc = new RTCPeerConnection({ iceServers: this.iceServers?.() ?? [] }); }
    catch { this.fail('This browser could not start a voice connection.'); return; }
    this.peer = pc; this.peerEpoch = epoch; const serial = ++this.peerSerial;
    this.queuedCandidates = [];
    try { for (const track of this.stream!.getAudioTracks()) pc.addTrack(track, this.stream!); }
    catch { this.fail('The microphone could not be connected. Enable voice to try again.'); return; }
    pc.onicecandidate = event => {
      if (!event.candidate || !this.validPeer(pc, serial, generation)) return;
      const candidate = event.candidate;
      const signal: VoiceSignal = { kind: 'candidate', candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment } };
      try { this.send({ type: 'voice-signal', epoch, signal }); }
      catch { if (this.validPeer(pc, serial, generation)) this.fail('Voice signaling failed. Enable voice to try again.'); }
    };
    pc.ontrack = event => {
      if (!this.validPeer(pc, serial, generation)) return;
      if (event.track.kind !== 'audio') return;
      const remote = new MediaStream([event.track]);
      this.audio.srcObject = remote; this.playbackBlocked = false; this.syncMedia();
    };
    pc.onconnectionstatechange = () => {
      if (!this.validPeer(pc, serial, generation)) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { this.fail('Voice connection failed. Enable voice to try again.'); return; }
      if (pc.connectionState === 'connected') this.clearConnectionTimer();
      else if (pc.connectionState === 'disconnected') this.startConnectionTimer(DISCONNECT_TIMEOUT_MS, pc, serial, generation);
      this.syncMedia(); this.reconcile();
    };
    this.startConnectionTimer(CONNECT_TIMEOUT_MS, pc, serial, generation);
    if (this.localId === 'p1') void this.makeOffer(pc, serial, generation);
  }
  private async makeOffer(pc: RTCPeerConnection, serial: number, generation: number): Promise<void> {
    try {
      const offer = await pc.createOffer(); if (!this.validPeer(pc, serial, generation)) return;
      await pc.setLocalDescription(offer); if (!this.validPeer(pc, serial, generation)) return;
      this.sendDescription(pc, 'offer');
    } catch { if (this.validPeer(pc, serial, generation)) this.fail('Voice connection could not start. Enable voice to try again.'); }
  }
  private sendDescription(pc: RTCPeerConnection, type: 'offer' | 'answer'): void {
    const sdp = pc.localDescription?.sdp;
    if (!sdp || this.peerEpoch < 0) throw new Error('Missing local voice description');
    this.send({ type: 'voice-signal', epoch: this.peerEpoch, signal: { kind: 'description', description: { type, sdp } } });
  }
  private syncMedia(): void {
    const connected = this.canTransmit();
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = connected && !this.muted;
    if (!connected) { this.playbackAttempt++; this.audio.pause(); return; }
    if (this.audio.srcObject && this.audio.paused && !this.playbackBlocked) void this.playRemote();
  }
  private startPartnerTimer(): void {
    if (this.partnerTimer) return;
    const token = this.generation;
    this.partnerTimer = setTimeout(() => {
      this.partnerTimer = undefined;
      if (token === this.generation && this.intended && !this.eligible()) this.fail('Voice timed out while waiting. Enable voice to try again.');
    }, PARTNER_TIMEOUT_MS);
  }
  private startConnectionTimer(delay: number, pc: RTCPeerConnection, serial: number, generation: number): void {
    if (this.connectionTimer) return;
    this.connectionTimer = setTimeout(() => {
      this.connectionTimer = undefined;
      if (this.validPeer(pc, serial, generation) && pc.connectionState !== 'connected') this.fail('Voice connection timed out. Enable voice to try again.');
    }, delay);
  }
  private closePeer(): void {
    this.clearConnectionTimer(); this.peerSerial++; this.playbackAttempt++;
    const pc = this.peer; this.peer = undefined; this.peerEpoch = -1; this.queuedCandidates = []; this.signalChain = Promise.resolve();
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close(); }
    this.audio.pause(); this.audio.srcObject = null; this.playbackBlocked = false;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false;
  }
  private teardown(notifyServer: boolean): void {
    const notify = notifyServer && this.announced;
    this.generation++; this.intended = false; this.requesting = false; this.announced = false; this.awaitingAck = false; this.ackObserved = false; this.muted = false;
    this.clearRequestTimer(); this.clearAckTimer(); this.clearPartnerTimer(); this.closePeer();
    const stream = this.stream; this.stream = undefined;
    if (stream) this.releaseStream(stream);
    this.playbackBlocked = false;
    if (notify) { try { this.send({ type: 'voice-enable', enabled: false }); } catch { /* Socket may have closed. */ } }
  }
  private releaseStream(stream: MediaStream) {
    for (const track of stream.getTracks()) { track.onended = null; track.enabled = false; track.stop(); }
    this.releaseCapture?.(stream);
  }
  private fail(message: string): void { this.teardown(true); this.publish('error', message); }
  private clearRequestTimer() { if (this.requestTimer) clearTimeout(this.requestTimer); this.requestTimer = undefined; }
  private clearAckTimer() { if (this.ackTimer) clearTimeout(this.ackTimer); this.ackTimer = undefined; }
  private clearPartnerTimer() { if (this.partnerTimer) clearTimeout(this.partnerTimer); this.partnerTimer = undefined; }
  private clearConnectionTimer() { if (this.connectionTimer) clearTimeout(this.connectionTimer); this.connectionTimer = undefined; }
  private publishCurrent() { this.publish(this.phase, this.message); }
  private publish(phase: VoiceStatus['phase'], message: string): void {
    this.phase = phase; this.message = message;
    const status: VoiceStatus = { enabled: !!this.stream && this.intended, muted: this.muted, phase, message, playbackBlocked: this.playbackBlocked };
    const next = JSON.stringify(status); if (next === this.lastStatus) return; this.lastStatus = next;
    this.onStatus(status);
  }
}
