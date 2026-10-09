import type { ClientMsg, ServerMsg } from '../core/types';

const PING_MS = 2000;

export const net = { online: false, rtt: 0 };
export const cid = sessionStorage.getItem('cid') ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
sessionStorage.setItem('cid', cid);

let ws: WebSocket | null = null, lastPing = 0;

export const send = (m: ClientMsg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

// Also called from onmessage: background tabs throttle timers, but incoming turns keep the heartbeat alive.
function ping() {
  if (performance.now() - lastPing < PING_MS / 2) return;
  lastPing = performance.now();
  send({ t: 'ping', ts: lastPing });
}

export function connect(onMessage: (m: ServerMsg) => void, onClose: () => void) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { send({ t: 'hello', cid }); send({ t: 'list' }); };
  ws.onclose = onClose;
  ws.onmessage = e => {
    const m: ServerMsg = JSON.parse(e.data);
    if (m.t === 'pong') net.rtt = performance.now() - m.ts;
    else onMessage(m);
    ping();
  };
  setInterval(ping, PING_MS);
}
