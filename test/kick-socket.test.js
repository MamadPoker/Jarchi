// Kick chat's connection: connectors/kick-chat.js connect() against a fake Pusher and a fake Kick (no network). A dead or
// stuck socket is left within 30 s and logged; while the channel is live, a message Pusher brings late comes from Kick's
// history instead, once. Plus the PC clock correction the delay badge uses (core/events).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-kick-socket-'));
process.env.JARCHI_DATA_DIR = dataDir;
const logged = () => { try { return fs.readFileSync(path.join(dataDir, 'logs', 'events.log'), 'utf8'); } catch { return ''; } };

const sockets = [];
globalThis.WebSocket = class {
  static OPEN = 1;
  constructor(url) { Object.assign(this, { url, readyState: 1, sent: [], answers: true }); sockets.push(this); }
  send(m) {
    this.sent.push(JSON.parse(m));
    if (this.answers && JSON.parse(m).event === 'pusher:ping') this.say({ event: 'pusher:pong' });
  }
  close() { this.readyState = 3; }
  say(m) { this.onmessage({ data: JSON.stringify(m) }); }
  pings() { return this.sent.filter((m) => m.event === 'pusher:ping').length; }
};

const kick = require('../connectors/kick-chat');
const { serverTime, clockAhead, chatMessage } = require('../core/events');

let onAir, history, asked;
kick.kickGet = async (p) => {
  asked.push(p);
  if (p.endsWith('/goals')) return { status: 200, json: [] };
  if (p.endsWith('/chat/connection')) return { status: 200, json: {} }; // the built-in Pusher address
  if (p.endsWith('/history')) return history.status ? { status: history.status } : { status: 200, json: { data: { messages: [...history] } } };
  return { status: 200, json: { id: 7, user_id: 1, chatroom: { id: 8 }, subscriber_badges: [], livestream: onAir ? { is_live: true } : null } };
};
const reads = () => asked.filter((p) => p.endsWith('/history')).length;

const flush = () => new Promise((r) => setImmediate(r));
// Time passes in 100 ms steps, with every promise and timer that depends on it run in between.
const pass = async (t, ms) => {
  for (let i = 0; i < ms / 100; i++) {
    t.mock.timers.tick(100);
    await flush();
  }
};

// Kick's history says a message like this: metadata as a string, newest first in the list.
const said = (id, ago, extra = {}) => ({ id, chat_id: 7, user_id: 1, content: `text ${id}`, type: 'message', metadata: '{"message_ref":"1"}',
  created_at: new Date(Date.now() - ago).toISOString(), sender: { id: 1, slug: 'viewer', username: 'Viewer', identity: { color: '#ffffff', badges: [], badges_v2: [] } }, ...extra });
const socketSays = (ws, m) => ws.say({ event: 'App\\Events\\ChatMessageEvent', channel: 'chatrooms.8.v2', data: JSON.stringify({ ...m, metadata: JSON.parse(m.metadata) }) });

async function started(t, { live = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  [onAir, history, asked] = [live, [], []];
  sockets.length = 0;
  const shown = [], states = [];
  const conn = kick.connect('viewer', { onStatus: (s) => states.push(s), onMessage: (m) => shown.push(m), onClear() {}, onChannel() {}, onGoals() {} });
  t.after(() => conn.stop());
  for (let i = 0; i < 10; i++) await flush();
  const ws = sockets[0];
  ws.say({ event: 'pusher:connection_established' });
  ws.say({ event: 'pusher_internal:subscription_succeeded', channel: 'chatrooms.8.v2' });
  return { conn, shown, states, ws, ids: () => shown.map((m) => m.id) };
}

test('a message Pusher brings late comes from Kick\'s history, once; one that is on time never does', async (t) => {
  const { shown, ws, ids } = await started(t);
  history.unshift(said('before', 60000));
  await pass(t, 5000);
  assert.equal(reads(), 1, 'read while live');
  assert.deepEqual(ids(), [], 'the first read only notes what was said before');

  socketSays(ws, said('on-time', 100));
  history.unshift(said('on-time', 100));
  await pass(t, 5000);
  assert.deepEqual(ids(), ['on-time'], 'Pusher\'s copy, not repeated from history');

  await pass(t, 4000);
  history.unshift(said('just-said', 0));
  await pass(t, 1100);
  assert.deepEqual(ids(), ['on-time'], 'a message under 2 s old is still Pusher\'s to bring');
  socketSays(ws, said('just-said', 1000));
  assert.deepEqual(ids(), ['on-time', 'just-said']);

  history.unshift(said('late-2', 29000, { type: 'reply', metadata: '{"original_sender":{"username":"Other"},"original_message":{"content":"yes?"}}' }), said('late-1', 30000));
  await pass(t, 5000);
  assert.deepEqual(ids().slice(2).sort(), ['late-1', 'late-2'], 'from history, without waiting for Pusher');
  assert.equal(ids()[2], 'late-1', 'oldest first (the list is newest first)');
  assert.equal(shown.find((m) => m.id === 'late-2').reply.name, 'Other', 'history\'s metadata is read like the socket\'s');
  assert.match(logged(), /kick socket chat late: .*3\d\.\d s ago/);

  const before = reads();
  await pass(t, 6000);
  assert.ok(reads() - before >= 2, 'read every 2 s while Pusher is late');

  socketSays(ws, said('late-1', 41000));
  assert.equal(ids().length, 4, 'Pusher\'s late copy shows nothing');

  await pass(t, 61000);
  assert.match(logged(), /kick socket chat late over: 2 messages from history, Pusher up to 4\d\.\d s behind/);
  const calm = reads();
  await pass(t, 10000);
  assert.equal(reads() - calm, 2, 'back to every 5 s');
});

test('history is read only while the channel is live, and a refusal only pauses it', async (t) => {
  const { ids } = await started(t, { live: false });
  await pass(t, 30000);
  assert.equal(reads(), 0, 'nothing asked while offline');

  onAir = true;
  await pass(t, 30000 + 5000);
  assert.ok(reads() > 0, 'the once-a-minute check found the stream');

  history = Object.assign([], { status: 403 });
  const before = reads();
  await pass(t, 10000);
  assert.ok(reads() - before <= 1, 'stops asking');
  assert.match(logged(), /kick socket history failed \(Kick answered 403\)/);
  history = [said('after', 30000)];
  await pass(t, 60000);
  assert.deepEqual(ids(), ['after'], 'and goes on after a minute');
});

test('a socket that stops answering is left within 30 s, logged, and connected again quickly', async (t) => {
  const { ws, states } = await started(t, { live: false });
  await pass(t, 60000);
  assert.equal(ws.pings(), 4, 'a ping every 15 s');
  assert.equal(sockets.length, 1, 'answered: nothing happens');

  ws.answers = false;
  const frames = setInterval(() => ws.onmessage && ws.say({ event: 'pusher:ping' }), 1000); // it still talks, but never answers: stuck
  const lost = Date.now();
  while (sockets.length < 2 && Date.now() - lost < 60000) await pass(t, 500);
  clearInterval(frames);
  assert.equal(sockets.length, 2, 'connected again');
  assert.ok(Date.now() - lost <= 34000, `took ${Date.now() - lost} ms`);
  assert.match(logged(), /kick socket no answer for \d+ s/);
  assert.match(logged(), /kick socket closed \(1006 no answer\)/);

  sockets[1].say({ event: 'pusher:connection_established' });
  sockets[1].say({ event: 'pusher_internal:subscription_succeeded', channel: 'chatrooms.8.v2' });
  assert.equal(states.at(-1), 'connected');
  assert.match(logged(), /kick socket back after \d+\.\d s/);
});

test('a socket that closes reconnects at once, and stop() ends everything', async (t) => {
  const { conn, ws } = await started(t, { live: false });
  ws.onclose({ code: 1006, reason: '' });
  await pass(t, 1000);
  for (let i = 0; i < 10; i++) await flush();
  assert.equal(sockets.length, 2, 'within a second');

  conn.stop();
  sockets[1].onclose({ code: 1000, reason: '' });
  const log = logged();
  await pass(t, 70000);
  assert.equal(sockets.length, 2, 'stays stopped');
  assert.equal(logged(), log, 'and quiet');
});

test('the PC clock\'s error comes from servers\' Date headers, and a message says it', () => {
  assert.equal(clockAhead(), 0, 'nothing known yet');
  const seen = (ahead, from = 1800000000000) => {
    for (let i = 0; i < 40; i++) {
      const real = from + i * 1370; // replies at all sorts of moments within a second
      serverTime(real + ahead, real + ahead + 100, Math.floor((real + 50) / 1000) * 1000);
    }
  };
  serverTime(Number.NaN, 0, Number.NaN);
  assert.equal(clockAhead(), 0, 'no Date header: nothing learned');

  seen(6600);
  assert.ok(Math.abs(clockAhead() - 6600) <= 100, `read ${clockAhead()}`);

  const platform = chatMessage({ platform: 'kick', time: 1800000000000, user: { name: 'a' } });
  assert.equal(platform.skew, clockAhead(), 'Kick\'s time is on Kick\'s clock');
  assert.equal(chatMessage({ platform: 'test', user: { name: 'a' } }).skew, 0, 'a time made here is on this PC\'s clock');

  seen(0, 1800001000000);
  assert.ok(Math.abs(clockAhead()) <= 100, `the clock was set right: read ${clockAhead()}`);
});
