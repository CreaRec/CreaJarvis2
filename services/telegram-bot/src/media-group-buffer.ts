/** Debounce Telegram media_group_id into one flush/ack. */
export class MediaGroupBuffer<T> {
  private readonly groups = new Map<
    string,
    { items: T[]; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly debounceMs: number,
    private readonly onFlush: (key: string, items: T[]) => void | Promise<void>,
  ) {}

  push(key: string, item: T): void {
    const existing = this.groups.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.items.push(item);
      existing.timer = setTimeout(() => {
        void this.flush(key);
      }, this.debounceMs);
      return;
    }
    const timer = setTimeout(() => {
      void this.flush(key);
    }, this.debounceMs);
    this.groups.set(key, { items: [item], timer });
  }

  private async flush(key: string): Promise<void> {
    const entry = this.groups.get(key);
    if (!entry) return;
    this.groups.delete(key);
    clearTimeout(entry.timer);
    await this.onFlush(key, entry.items);
  }
}
