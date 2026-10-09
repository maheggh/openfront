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

- **Smooth playback**: turns go into a queue and are played at a steady 100 ms pace from `requestAnimationFrame`; when more than 2 turns are queued the client catches up in time-sliced chunks (8 ms per frame, 30 ms when far behind). Rendering interpolates ships, nukes and blasts between ticks.
- **Background tabs**: when the tab is hidden, turns are applied as soon as they arrive (message-driven, no timers), so the game never falls behind; heartbeats also piggyback on incoming turns.
- **Optimistic feedback**: your own actions show a pulsing marker immediately until the turn containing them is applied.
- **Reconnect**: each tab has a client id; after a disconnect the page reloads, and the server sends the config plus the full turn history, which is replayed in chunks with a "catching up" indicator. Rooms survive 60s with nobody connected.
- **Desync detection**: every 50 ticks clients send a state hash; the server logs mismatches and the affected client automatically reloads and replays once.
- **Server hardening**: compact turn messages (empty turns are `{"t":"turn"}`), intent shape validation, 20 intents/s rate limit, 64 KB message cap, ping/RTT (shown in the HUD), idle sockets dropped after 15s, and clients with a backed-up send buffer are dropped so they reconnect and replay.
- **Performance**: only changed tiles are repainted; each player keeps an incremental border-tile set and territory centroid, so attacks, bots and click checks no longer scan the whole map; trade routes are cached until the sea rises.

```
src/core/
  config.ts     all tuning constants, costs, doctrines
  types.ts      intents, protocol messages, intent validation
  map.ts        procedural map + tile helpers
  game.ts       Game state, queries, ownership, turn step and intent dispatch
  attack.ts     land attacks
  units.ts      transports, trade ships, warships, nukes, water pathfinding
  economy.ts    building and income/regen
  diplomacy.ts  alliances, embargo, spies, sabotage, bounties
  world.ts      storms, rising sea
  bots.ts       AI
src/server/     Node + ws lobby/turn relay (and static file server for production)
src/client/
  main.ts       menu, lobby, game start
  net.ts        WebSocket, heartbeat
  runner.ts     turn queue, pacing, catch-up, pending intents
  render.ts     canvas renderer
  ui.ts         HUD, build bar, context menu
  input.ts      mouse and keyboard
  actions.ts    player actions with client-side checks
  dom.ts        small DOM helpers
```
