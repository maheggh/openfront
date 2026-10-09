import { BLAST_TICKS, EMOJI_TICKS, MAX_STORMS, SEA_MAX_RISE, SEA_START, SEA_STEP, SEA_STEP_TICKS, STORM_EVERY } from './config';
import type { Game } from './game';
import { H, SEA, W, WATER } from './map';

export function stepWorld(g: Game) {
  if (g.tick % STORM_EVERY === 0 && g.storms.length < MAX_STORMS) {
    const left = g.rand() < 0.5;
    g.storms.push({ x: left ? -40 : W + 40, y: g.rand() * H, r: 25 + g.rand() * 25, vx: (left ? 1 : -1) * (0.15 + g.rand() * 0.15), vy: (g.rand() - 0.5) * 0.2 });
  }
  for (const s of g.storms) { s.x += s.vx; s.y += s.vy; }
  g.storms = g.storms.filter(s => s.x > -60 && s.x < W + 60);
  if (g.tick >= SEA_START && g.tick % SEA_STEP_TICKS === 0 && g.seaLevel < SEA + SEA_MAX_RISE) flood(g);
  g.blasts = g.blasts.filter(b => g.tick - b.tick < BLAST_TICKS);
  g.emojis = g.emojis.filter(e => g.tick - e.tick < EMOJI_TICKS);
  g.spies = g.spies.filter(s => s.until > g.tick);
}

function flood(g: Game) {
  g.seaLevel += SEA_STEP;
  const { terrain, height, resource } = g.map;
  for (let i = 0; i < W * H; i++) {
    if (terrain[i] === WATER || height[i] >= g.seaLevel) continue;
    g.setOwner(i, 0);
    terrain[i] = WATER;
    resource[i] = 0;
    g.landTiles--;
  }
  g.pathCache.clear();
  g.terrainVersion++;
  g.event('🌊 The sea is rising! Coastal land floods.');
}
