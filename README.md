# Frontfall

A real-time multiplayer territory-control browser game inspired by OpenFront.io, with its own twists.

## Run

```bash
npm install
npm run dev      # Vite client on http://localhost:5173 + WebSocket server on :3001
```

Production: `npm run build` then `npm start` (server serves `dist/` and `/ws` on port 3001, or `PORT`).

## How to play

- **Spawn**: during the first 10 seconds pick a doctrine and click the map to place your capital.
- **Expand / attack**: left-click neutral land or a neighbor to send troops (attack-ratio slider at the bottom). Clicking an unreachable coast sends a transport boat.
- **Build**: keys `1`–`6` or the bottom bar: City (+max troops), Port (+gold), Defense post (3x defense in radius), Missile silo, Nuke (needs silo), Sabotage.
- **Diplomacy**: right-click another player to request, accept or break an alliance, spy, place a bounty, or send an emote.
- **Camera**: drag to pan, mouse wheel to zoom.
- **Win**: be the last player standing or control 70% of the land.

## Unique features

- **Day/night cycle**: every 2 minutes night falls for 40s; defenders get +25%.
- **Storm fronts**: storms drift across the map, slowing attacks and blocking boats inside them.
- **Resource tiles**: oil (black) and gold mines (yellow) give extra gold; fertile land (bright green) boosts troop regen and max troops.
- **Doctrines**: Blitz (faster, cheaper attacks), Fortress (+35% defense), Merchant (+35% gold), Naval (2x boat speed, +25% landing troops).
- **Rising sea**: after ~6.5 minutes the sea rises in steps, flooding low coastal land to force conflict.
- **Spies & sabotage**: reveal a rival's hidden troop count for 30s, or disable an enemy structure for 60s.
- **Bounties**: put gold on a player's head; whoever captured most of their land when they die collects it.

## Architecture

Deterministic lockstep: the server only collects intents and broadcasts them every 100 ms turn; every client runs the same simulation (`src/core`) from a shared seed. Singleplayer runs the same loop locally without a server.

```
src/core    shared simulation: map generation, rules, bots, message types
src/server  Node + ws lobby/turn relay (and static file server for production)
src/client  Vite + Canvas 2D renderer and plain DOM UI
```
