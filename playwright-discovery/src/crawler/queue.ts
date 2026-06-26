/**
 * URL queue with dedup, depth tracking, and BFS/DFS support.
 */

export interface QueueItem {
  url: string;
  depth: number;
  /** URL of the page that linked to this one, if any. */
  parent?: string;
  /** Element text or label that triggered the discovery. */
  trigger?: string;
}

export type Strategy = 'bfs' | 'dfs';

export class UrlQueue {
  private items: QueueItem[] = [];
  private seen = new Set<string>();

  constructor(private readonly strategy: Strategy = 'bfs') {}

  /**
   * Enqueue a URL. Returns true if newly added, false if already seen.
   */
  enqueue(item: QueueItem): boolean {
    if (this.seen.has(item.url)) return false;
    this.seen.add(item.url);
    this.items.push(item);
    return true;
  }

  /**
   * Mark a URL as seen without enqueueing (e.g. starting URL).
   */
  markSeen(url: string): void {
    this.seen.add(url);
  }

  hasSeen(url: string): boolean {
    return this.seen.has(url);
  }

  dequeue(): QueueItem | undefined {
    if (this.items.length === 0) return undefined;
    if (this.strategy === 'bfs') {
      return this.items.shift();
    }
    return this.items.pop();
  }

  size(): number {
    return this.items.length;
  }

  seenCount(): number {
    return this.seen.size;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  peek(): QueueItem | undefined {
    if (this.items.length === 0) return undefined;
    return this.strategy === 'bfs' ? this.items[0] : this.items[this.items.length - 1];
  }

  /**
   * Remaining items, in queue order (used for reporting).
   */
  pending(): QueueItem[] {
    return [...this.items];
  }
}
