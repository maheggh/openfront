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
- **Expand / attack**: left-click neutral land or a neighbor to send troops. Clicking a coast you can't reach by land sends a transport boat.
- **Attack ratio**: bottom slider or `Shift` + mouse wheel.
- **Right-click** any tile for a context menu: build, attack/boat, nuke, sabotage, alliance, spy, bounty, embargo, emotes. Unaffordable options are dimmed.
- **Build hotkeys** `1`–`8`: City, Port, Defense post, Missile silo, SAM launcher, Warship, Nuke, Sabotage (`Esc` cancels). Costs rise by 50% for each one of that type you own.
- **Camera**: drag to pan, mouse wheel to zoom (smoothly, toward the cursor).
- **Win**: be the last player standing or control 65% of the land.

## OpenFront features

Cities (+max troops), ports (gold + automatic trade ships to other players' ports, paying both sides), defense posts, missile silos and nukes, SAM launchers (intercept nukes within range), warships (patrol near their port, sink transports, capture trade ships, fight other warships), alliances, embargoes, emotes, and AI bots that expand, target weak neighbors, counter-attack threats, build defenses, ports, silos and SAMs, and nuke rivals.

## Unique features

- **Day/night cycle**: every 2 minutes night falls for 40s; defenders get +25% and cities glow.
- **Storm fronts**: storms drift across the map, slowing attacks and blocking all ships inside them.
- **Resource tiles**: oil (dark) and gold mines (yellow) give extra gold; fertile land (bright green) boosts troop regen and max troops.
- **Doctrines**: Blitz (faster, cheaper attacks), Fortress (+35% defense), Merchant (+35% gold and trade), Naval (2x transport speed, +25% landing troops).
- **Rising sea**: after ~6.5 minutes the sea rises every 30s for 5 minutes, flooding low coastal land to force conflict.
- **Spies & sabotage**: reveal a rival's hidden troop count for 30s, or disable an enemy structure for 60s.
- **Bounties**: put gold on a player's head; whoever captured most of their land when they die collects it.

## Architecture

Deterministic lockstep: the server only collects intents and broadcasts them every 100 ms turn; every client runs the same simulation (`src/core`) from a shared seed. Singleplayer runs the same loop locally without a server.

- **Reconnect**: each tab has a client id; after a disconnect the page reloads, and the server sends the game config plus the full turn history so the client replays to the current state. Rooms survive 60s with nobody connected.
- **Desync detection**: every 50 ticks clients send a state hash; the server logs mismatches and warns the affected client.

```
src/core    shared simulation: map generation, rules, bots, message types
src/server  Node + ws lobby/turn relay (and static file server for production)
src/client  Vite + Canvas 2D renderer and plain DOM UI
```
