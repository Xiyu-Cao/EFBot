/**
 * PriorityQueue — stable-ordered by `time`, then by insertion order.
 *
 * When two items have the same `time`, they are dequeued in the order
 * they were enqueued (FIFO).  This guarantees deterministic execution
 * for same-tick events.
 */
export class PriorityQueue<T extends { time: number }> {
  private items: Array<T & { _seq: number }> = [];
  private seq = 0;

  constructor(initialItems: T[] = []) {
    for (const item of initialItems) {
      this.enqueue(item);
    }
  }

  getItems(): T[] {
    return this.items;
  }

  enqueue(item: T) {
    const tagged = Object.assign({}, item, { _seq: this.seq++ });
    this.items.push(tagged);
    this.items.sort((a, b) => a.time - b.time || a._seq - b._seq);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  clone() {
    return new PriorityQueue<T>(this.toArray());
  }

  toArray(): T[] {
    return this.items.map(({ _seq, ...rest }) => rest as unknown as T);
  }
}
