export type Doctrine = 'blitz' | 'fortress' | 'merchant' | 'naval';
export type StructureType = 'city' | 'port' | 'defense' | 'silo' | 'sam';
export type BuildKind = StructureType | 'warship';

export type IntentBody =
  | { type: 'spawn'; x: number; y: number; doctrine: Doctrine }
  | { type: 'attack'; target: number; ratio: number }
  | { type: 'boat'; x: number; y: number; ratio: number }
  | { type: 'build'; x: number; y: number; kind: BuildKind }
  | { type: 'nuke'; x: number; y: number }
  | { type: 'sabotage'; x: number; y: number }
  | { type: 'ally' | 'unally' | 'spy' | 'bounty' | 'embargo'; target: number }
  | { type: 'emoji'; target: number; emoji: string };
export type Intent = IntentBody & { p: number };

export interface PlayerInfo { name: string; bot: boolean }
export interface GameConfig { seed: number; players: PlayerInfo[] }
export interface LobbyInfo { id: string; players: number; startsIn: number }

export type ClientMsg =
  | { t: 'hello'; cid: string }
  | { t: 'ping'; ts: number }
  | { t: 'list' }
  | { t: 'joinPublic'; name: string; id?: string }
  | { t: 'create'; name: string; bots: number }
  | { t: 'joinCode'; name: string; code: string }
  | { t: 'start' }
  | { t: 'intent'; intent: IntentBody }
  | { t: 'hash'; tick: number; hash: number };

export type ServerMsg =
  | { t: 'lobbies'; lobbies: LobbyInfo[] }
  | { t: 'lobby'; code: string; players: string[]; host: boolean; startsIn: number | null }
  | { t: 'start'; config: GameConfig; me: number; turns?: Intent[][] }
  | { t: 'turn'; i?: Intent[] }
  | { t: 'pong'; ts: number }
  | { t: 'desync'; tick: number }
  | { t: 'error'; msg: string };

const NUMERIC: Record<IntentBody['type'], string[]> = {
  spawn: ['x', 'y'], attack: ['target', 'ratio'], boat: ['x', 'y', 'ratio'], build: ['x', 'y'], nuke: ['x', 'y'], sabotage: ['x', 'y'],
  ally: ['target'], unally: ['target'], spy: ['target'], bounty: ['target'], embargo: ['target'], emoji: ['target'],
};
const TEXT: Partial<Record<IntentBody['type'], string>> = { spawn: 'doctrine', build: 'kind', emoji: 'emoji' };

// Copies only known fields so the server relays compact, well-formed intents; game rules are checked in the simulation.
export function cleanIntent(x: unknown): IntentBody | null {
  const src = x as Record<string, unknown> | null;
  const type = src?.type;
  if (!src || typeof type !== 'string' || !Object.hasOwn(NUMERIC, type)) return null;
  const out: Record<string, unknown> = { type };
  for (const f of NUMERIC[type as IntentBody['type']]) {
    const v = src[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[f] = v;
  }
  const text = TEXT[type as IntentBody['type']];
  if (text) out[text] = String(src[text]).slice(0, 12);
  return out as unknown as IntentBody;
}
