import type { BuildKind, Doctrine, StructureType } from './types';

export const TICK_MS = 100, BUFFER_TURNS = 2, HASH_EVERY = 50;

export const SPAWN_TICKS = 100, SPAWN_RADIUS = 3, START_TROOPS = 3000;
export const DAY = 1200, NIGHT_START = 800;
export const SEA_START = 4000, SEA_STEP_TICKS = 300, SEA_STEP = 0.004, SEA_MAX_RISE = 0.04;
export const WIN_SHARE = 0.65, BOT_EVERY = 10, MAX_EVENTS = 100;

export const TROOPS_BASE = 5000, TROOPS_PER_TILE = 15, TROOPS_PER_FERTILE = 40, TROOPS_PER_CITY = 15000;
export const REGEN_BASE = 10, REGEN_SQRT = 0.8, REGEN_PER_FERTILE = 0.1;
export const GOLD_BASE = 0.5, GOLD_PER_TILE = 0.002, GOLD_PER_OIL = 0.1, GOLD_PER_MINE = 0.2, GOLD_PER_PORT = 1;

export const TERRAIN_COST = [0, 1.5, 2.5, 4], TERRAIN_SPEED = [0, 1, 1.5, 2.5];
export const ATTACK_SPEED = 4, ATTACK_SPEED_DIV = 3, DENSITY_COST = 1.2, DENSITY_LOSS = 0.6;
export const NIGHT_DEFENSE = 1.25, DEFENSE_MULT = 3, DEFENSE_R = 12;
export const STORM_COST = 1.5, STORM_SLOW = 2, STORM_EVERY = 500, MAX_STORMS = 4;
export const BLITZ_SPEED = 1.5, BLITZ_COST = 0.85, FORTRESS_DEFENSE = 1.35, MERCHANT_GOLD = 1.35, NAVAL_SPEED = 2, NAVAL_TROOPS = 1.25;

export const NUKE_R = 12, NUKE_DELAY = 20, NUKE_SPEED = 4, NUKE_TROOP_LOSS = 1.5, SAM_R = 30, SAM_COOLDOWN = 150, SILO_COOLDOWN = 100;
export const MAX_TRANSPORTS = 3, MAX_TRADE_SHIPS = 5, TRADE_EVERY = 120, TRADE_BASE = 30, TRADE_PER_TILE = 0.8;
export const WARSHIP_HP = 100, WARSHIP_DAMAGE = 4, WARSHIP_SIGHT2 = 144, WARSHIP_REACH2 = 4, PATROL_R = 25;
export const SPY_TICKS = 300, SABOTAGE_TICKS = 600, SABOTAGE_REACH2 = 9, EMOJI_TICKS = 50, BLAST_TICKS = 20;
export const BUILD_SPACING2 = 16, COST_GROWTH = 0.5;

export const COSTS = { city: 2000, port: 2000, defense: 1000, silo: 5000, sam: 3000, warship: 2500, nuke: 4000, spy: 800, sabotage: 1500, bounty: 2000 };
export const STRUCTURES: StructureType[] = ['city', 'port', 'defense', 'silo', 'sam'];
export const BUILDS: BuildKind[] = [...STRUCTURES, 'warship'];
export const LABELS: Record<BuildKind, string> = { city: 'City', port: 'Port', defense: 'Defense post', silo: 'Missile silo', sam: 'SAM launcher', warship: 'Warship' };
export const EMOJIS: string[] = ['👍', '😠', '🤝', '💀', '😂', '🎯'];

export const DOCTRINES: Record<Doctrine, string> = {
  blitz: 'Attacks 50% faster and 15% cheaper',
  fortress: 'Defense +35%',
  merchant: 'Gold income and trade +35%',
  naval: 'Transports 2x faster, +25% landing troops',
};

const NAMES = ['Aurelia', 'Borealis', 'Carthos', 'Dravia', 'Elmoor', 'Fenwick', 'Galdor', 'Hestia', 'Ithria', 'Jorvik', 'Kalmar', 'Lysandra', 'Morvane', 'Nordheim', 'Ostara', 'Pyrrhia', 'Quellen', 'Rhodan', 'Sylvara', 'Tarsis'];
export const botName = (i: number) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ' II' : '');
