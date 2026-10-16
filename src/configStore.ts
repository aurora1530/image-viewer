/** One in-memory document per root. Writes never overlap and retain later edits. */
export class ConfigStore<T> {
  private document: Promise<T> | null = null;
  private revision = 0;
  private savedRevision = 0;
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private changes: Promise<void> = Promise.resolve();
  private readonly load: () => Promise<T>;
  private readonly save: (payload: string) => Promise<void>;

  constructor(
    load: () => Promise<T>,
    save: (payload: string) => Promise<void>
  ) {
    this.load = load;
    this.save = save;
  }

  private loadDocument(): Promise<T> {
    if (!this.document) {
      this.document = this.load().catch(error => {
        this.document = null;
        throw error;
      });
    }
    return this.document;
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.changes.then(operation);
    this.changes = result.then(() => undefined, () => undefined);
    return result;
  }

  read(): Promise<T> {
    return this.changes.then(() => this.loadDocument());
  }

  update<R>(change: (document: T) => R): Promise<R> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const result = change(document);
      this.revision++;
      return result;
    });
  }

  scheduleSave(onError: (error: unknown) => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(onError);
    }, 250);
  }

  async flush(): Promise<void> {
    await this.changes;
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A flush of an unopened store must not create a config file.
    if (!this.document) return;
    const document = await this.loadDocument();
    if (this.saving) {
      await this.saving;
      // An edit can arrive as the preceding write is completing.
      if (this.savedRevision !== this.revision) await this.persist();
      return;
    }
    this.saving = (async () => {
      while (this.savedRevision !== this.revision) {
        const revision = this.revision;
        const payload = JSON.stringify(document, null, 2);
        await this.save(payload);
        this.savedRevision = revision;
      }
    })().finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  reload(): Promise<T> {
    return this.enqueue(async () => {
      await this.persist();
      this.document = null;
      return this.loadDocument();
    });
  }
}
