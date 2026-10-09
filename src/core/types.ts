export type Doctrine = 'blitz' | 'fortress' | 'merchant' | 'naval';
export type StructureType = 'city' | 'port' | 'defense' | 'silo';

export const DOCTRINES: Record<Doctrine, string> = {
  blitz: 'Attacks 50% faster and 15% cheaper',
  fortress: 'Defense +35%',
  merchant: 'Gold income +35%',
  naval: 'Boats 2x faster, +25% landing troops',
};

export const COSTS = { city: 3000, port: 2500, defense: 1500, silo: 6000, nuke: 4000, spy: 1000, sabotage: 2000, bounty: 2000 };
export const EMOJIS: string[] = ['👍', '😠', '🤝', '💀', '😂', '🎯'];
export const TICK_MS = 100;

const NAMES = ['Aurelia', 'Borealis', 'Carthos', 'Dravia', 'Elmoor', 'Fenwick', 'Galdor', 'Hestia', 'Ithria', 'Jorvik', 'Kalmar', 'Lysandra', 'Morvane', 'Nordheim', 'Ostara', 'Pyrrhia', 'Quellen', 'Rhodan', 'Sylvara', 'Tarsis'];
export const botName = (i: number) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ' II' : '');

export type IntentBody =
  | { type: 'spawn'; x: number; y: number; doctrine: Doctrine }
  | { type: 'attack'; target: number; ratio: number }
  | { type: 'boat'; x: number; y: number; ratio: number }
  | { type: 'build'; x: number; y: number; kind: StructureType }
  | { type: 'nuke'; x: number; y: number }
  | { type: 'sabotage'; x: number; y: number }
  | { type: 'ally' | 'unally' | 'spy' | 'bounty'; target: number }
  | { type: 'emoji'; target: number; emoji: string };
export type Intent = IntentBody & { p: number };

export interface PlayerInfo { name: string; bot: boolean }
export interface GameConfig { seed: number; players: PlayerInfo[] }
export interface LobbyInfo { id: string; players: number; startsIn: number }

export type ClientMsg =
  | { t: 'list' }
  | { t: 'joinPublic'; name: string; id?: string }
  | { t: 'create'; name: string; bots: number }
  | { t: 'joinCode'; name: string; code: string }
  | { t: 'start' }
  | { t: 'intent'; intent: IntentBody };

export type ServerMsg =
  | { t: 'lobbies'; lobbies: LobbyInfo[] }
  | { t: 'lobby'; code: string; players: string[]; host: boolean; startsIn: number | null }
  | { t: 'start'; config: GameConfig; me: number }
  | { t: 'turn'; intents: Intent[] }
  | { t: 'error'; msg: string };
