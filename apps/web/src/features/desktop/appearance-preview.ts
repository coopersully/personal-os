/** A transport queue, not a history: superseded pointer samples are never replayed. */
export class LatestAppearanceQueue<T> {
  private pending: { value: T } | undefined;
  private running: Promise<void> | undefined;
  private disposed = false;
  constructor(
    private readonly send: (value: T) => Promise<unknown>,
    private readonly report: (error: unknown) => void,
  ) {}
  submit(value: T) {
    if (this.disposed) return;
    this.pending = { value };
    this.running ??= this.drain();
  }
  private async drain() {
    while (this.pending && !this.disposed) {
      const { value } = this.pending;
      this.pending = undefined;
      try {
        await Promise.resolve().then(() => this.send(value));
      } catch (error) {
        if (!this.disposed) this.report(error);
      }
    }
    this.running = undefined;
  }
  async flush() {
    await this.running;
  }
  dispose() {
    this.disposed = true;
    this.pending = undefined;
  }
}
