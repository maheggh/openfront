import { BUFFER_TURNS, TICK_MS } from '../core/config';
import type { Game } from '../core/game';
import type { Intent } from '../core/types';

export interface Pending { tile: number; label: string; at: number }

const FRAME_BUDGET_MS = 8, CATCHUP_BUDGET_MS = 30, CATCHUP_TURNS = 50, PENDING_MS = 3000;

// Plays turns at a steady TICK_MS pace from a small jitter buffer, and catches up in time-sliced chunks when behind.
export class Runner {
  queue: Intent[][] = [];
  pending: Pending[] = [];
  stepAt = 0;
  private nextAt = 0;

  constructor(public g: Game, public me: number, private onTick: () => void) {
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.drain(); });
  }

  get behind() { return this.queue.length; }

  push(turn: Intent[]) {
    this.queue.push(turn);
    if (document.hidden) this.drain();
  }

  pump() {
    const now = performance.now(), budget = this.queue.length > CATCHUP_TURNS ? CATCHUP_BUDGET_MS : FRAME_BUDGET_MS;
    if (this.nextAt < now - TICK_MS) this.nextAt = now;
    if (this.queue.length && now >= this.nextAt) { this.run(); this.nextAt += TICK_MS; }
    while (this.queue.length > BUFFER_TURNS && performance.now() - now < budget) this.run();
    this.pending = this.pending.filter(p => now - p.at < PENDING_MS);
  }

  private drain() { while (this.queue.length) this.run(); }

  private run() {
    const turn = this.queue.shift()!, tick = this.g.tick;
    this.g.step(turn);
    this.pending.splice(0, turn.filter(it => it.p === this.me).length);
    this.stepAt = performance.now();
    if (this.g.tick !== tick) this.onTick();
  }
}
