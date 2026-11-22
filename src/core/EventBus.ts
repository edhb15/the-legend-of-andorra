type Handler = (payload?: any) => void;

/** Tiny pub/sub used to decouple game systems. */
export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, h: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(h);
    return () => set!.delete(h);
  }

  emit(event: string, payload?: any): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (e) {
        console.error(`[EventBus] handler for "${event}" failed`, e);
      }
    }
  }
}
