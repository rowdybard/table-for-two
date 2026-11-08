/** A single physical capture with independently owned tracks for voice and ASR. */
export class SharedMicrophone {
  private source?: MediaStream;
  private opening?: Promise<MediaStream>;
  private readonly leases = new Set<MediaStream>();
  private disposed = false;

  async acquire(): Promise<MediaStream> {
    if (this.disposed) throw new DOMException('Microphone capture ended.', 'AbortError');
    if (this.source && !this.source.getAudioTracks().some(track => track.readyState === 'live')) this.source = undefined;
    if (!this.opening && !this.source?.getAudioTracks().some(track => track.readyState === 'live')) {
      const opening = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 }, video: false,
      });
      this.opening = opening;
      void opening.finally(() => { if (this.opening === opening) this.opening = undefined; }).catch(() => {});
    }
    const source = this.source ?? await this.opening!;
    if (this.disposed) { source.getTracks().forEach(track => track.stop()); throw new DOMException('Microphone capture ended.', 'AbortError'); }
    this.source = source;
    const stream = new MediaStream(source.getAudioTracks().map(track => track.clone()));
    this.leases.add(stream);
    return stream;
  }

  release(stream: MediaStream) {
    stream.getTracks().forEach(track => track.stop());
    this.leases.delete(stream);
    if (!this.leases.size) { this.source?.getTracks().forEach(track => track.stop()); this.source = undefined; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const stream of [...this.leases]) this.release(stream);
    this.source?.getTracks().forEach(track => track.stop()); this.source = undefined;
    void this.opening?.then(stream => stream.getTracks().forEach(track => track.stop())).catch(() => {});
  }
}
