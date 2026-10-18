// Jarchi's Kick relay, a Cloudflare Worker (free plan). Kick's login needs the Kick app's secret, which can't ship
// inside Jarchi, and Kick sends a channel's events (follows) only as webhooks to one public address. This holds the
// secret and that address, so each streamer's Jarchi needs neither:
//   GET  /login     Jarchi's Connect Kick opens this: on to Kick's login page with this app's Client ID
//   GET  /callback  Kick comes back here; on to the Jarchi that asked (127.0.0.1:<port>, the port is in `state`)
//   POST /token     Jarchi's code (with its PKCE verifier) or refresh token -> Kick's tokens, the secret added here
//   POST /webhook   Kick's events: the signature is checked, then each goes to its channel's Room
//   GET  /ws        Jarchi's WebSocket: the Kick token it sends says whose channel it is, and it joins that Room
// Nothing is stored: an event goes to the sockets open right now, or nowhere.
// Settings (secrets): KICK_CLIENT_ID, KICK_CLIENT_SECRET. Deploy: see README.md here.
const KICK_ID = 'https://id.kick.com';
const KICK_API = 'https://api.kick.com/public/v1';
const SCOPES = 'user:read events:subscribe';
const STALE_MS = 10 * 60 * 1000; // an older event (Kick trying again much later) is dropped: a late alert is no alert

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const room = (env, userId) => env.ROOMS.get(env.ROOMS.idFromName(String(userId)));
const STATE = /^(\d{2,5})\.[\w-]{16,128}$/; // "<Jarchi's port>.<random>"

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/': return text('Jarchi Kick relay: running.');
      case '/login': return login(url, env);
      case '/callback': return callback(url);
      case '/token': return req.method === 'POST' ? token(req, url, env) : text('POST only', 405);
      case '/webhook': return req.method === 'POST' ? webhook(req, env) : text('POST only', 405);
      case '/ws': return socket(req, env);
    }
    return text('Not found', 404);
  },
};

function login(url, env) {
  const state = url.searchParams.get('state') ?? '', challenge = url.searchParams.get('challenge') ?? '';
  if (!STATE.test(state) || !/^[\w-]{43}$/.test(challenge)) return text('Bad request', 400);
  return Response.redirect(`${KICK_ID}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: env.KICK_CLIENT_ID, redirect_uri: `${url.origin}/callback`, scope: SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', state,
  })}`, 302);
}

// Only ever back to this PC (127.0.0.1), so this is no open redirect. Jarchi checks the state itself.
function callback(url) {
  const port = Number(STATE.exec(url.searchParams.get('state') ?? '')?.[1]);
  if (!(port >= 1 && port <= 65535)) return text('Bad request', 400);
  return Response.redirect(`http://127.0.0.1:${port}/api/kick/callback${url.search}`, 302);
}

async function token(req, url, env) {
  const b = await req.json().catch(() => ({}));
  const grant = b.refresh_token
    ? { grant_type: 'refresh_token', refresh_token: String(b.refresh_token) }
    : { grant_type: 'authorization_code', code: String(b.code ?? ''), code_verifier: String(b.code_verifier ?? ''), redirect_uri: `${url.origin}/callback` };
  const r = await fetch(`${KICK_ID}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...grant, client_id: env.KICK_CLIENT_ID, client_secret: env.KICK_CLIENT_SECRET }),
  });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
}

// Kick's public key (it can change: fetched again when a signature doesn't match, at most once a minute).
let key = { at: 0, value: null };
async function publicKey(again) {
  if (key.value && Date.now() - key.at < (again ? 60000 : 3600000)) return key.value;
  const body = await (await fetch(`${KICK_API}/public-key`)).text();
  let pem = body;
  try { pem = JSON.parse(body).data.public_key; } catch {}
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  key = { at: Date.now(), value: await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) };
  return key.value;
}

// Kick signs "<message id>.<timestamp>.<raw body>" (RSA, SHA-256), base64 in Kick-Event-Signature.
async function signed(h, body) {
  const id = h.get('kick-event-message-id'), time = h.get('kick-event-message-timestamp'), sig = h.get('kick-event-signature');
  if (!id || !time || !sig) return false;
  let bytes;
  try { bytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)); } catch { return false; }
  const data = new TextEncoder().encode(`${id}.${time}.${body}`);
  for (const again of [false, true]) if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await publicKey(again), bytes, data)) return true;
  return false;
}

async function webhook(req, env) {
  const body = await req.text(), h = req.headers;
  if (!(await signed(h, body))) return text('Bad signature', 403);
  if (Math.abs(Date.now() - Date.parse(h.get('kick-event-message-timestamp'))) > STALE_MS) return text('ok'); // not again either
  let data;
  try { data = JSON.parse(body); } catch { return text('ok'); }
  const channel = data?.broadcaster?.user_id;
  if (channel) {
    await room(env, channel).fetch('https://room/event', { method: 'POST', body: JSON.stringify({
      type: h.get('kick-event-type'), version: h.get('kick-event-version'), id: h.get('kick-event-message-id'), data,
    }) });
  }
  return text('ok');
}

// Whose channel: Kick's answer for the token Jarchi sends (Authorization header), so a Jarchi gets its own channel only.
async function socket(req, env) {
  if (req.headers.get('upgrade') !== 'websocket') return text('WebSocket only', 426);
  const r = await fetch(`${KICK_API}/users`, { headers: { authorization: req.headers.get('authorization') ?? '' } });
  const me = r.ok && (await r.json().catch(() => null))?.data?.[0]?.user_id;
  if (!me) return text('Unauthorized', 401);
  return room(env, me).fetch(req);
}

// One channel: the Jarchi sockets open for it (usually one), handed each of its events. Hibernates between them; the
// keepalive ("ping" -> "pong") is answered without waking it.
export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    if (req.headers.get('upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const event = await req.text();
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(event); } catch {} // one closing just now
    }
    return text('ok');
  }

  webSocketMessage() {} // Jarchi sends nothing else

  webSocketClose(ws) {
    try { ws.close(); } catch {}
  }
}
