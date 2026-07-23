export type SaveQueueOptions = {
  saveAs?: boolean
}

type SaveBatch = {
  options: SaveQueueOptions
  resolve: Array<(result: boolean) => void>
}

/**
 * Runs at most one save at a time and coalesces bursts into one follow-up save.
 *
 * A follow-up is important: if the document changes during a long save and the
 * user presses Ctrl+S again, returning the first promise would leave that newer
 * edit unsaved. Keeping only one queued batch avoids both lost intent and an
 * unbounded backlog of expensive media-pack operations.
 */
export class SaveQueue {
  private running = false
  private queued: SaveBatch | null = null
  private idleResolvers: Array<() => void> = []

  constructor(
    private readonly worker: (options: SaveQueueOptions) => Promise<boolean>,
  ) {}

  enqueue(options: SaveQueueOptions = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const request: SaveBatch = {
        options: { saveAs: options.saveAs === true },
        resolve: [resolve],
      }

      if (!this.running) {
        this.running = true
        void this.runBatch(request)
        return
      }

      if (this.queued) {
        // Preserve an explicit Save As request when regular Ctrl+S repeats.
        this.queued.options.saveAs =
          this.queued.options.saveAs === true || options.saveAs === true
        this.queued.resolve.push(resolve)
      } else {
        this.queued = request
      }
    })
  }

  waitForIdle(): Promise<void> {
    if (!this.running && !this.queued) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private async runBatch(batch: SaveBatch): Promise<void> {
    let result = false
    try {
      result = await this.worker(batch.options)
    } catch {
      // The UI worker normally reports its own error. Keep the queue usable even
      // if a future worker unexpectedly throws before reaching that boundary.
      result = false
    }

    for (const resolve of batch.resolve) resolve(result)

    const next = this.queued
    this.queued = null
    if (next) {
      await this.runBatch(next)
      return
    }

    this.running = false
    const idle = this.idleResolvers
    this.idleResolvers = []
    for (const resolve of idle) resolve()
  }
}
