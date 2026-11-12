// Help for filtered networks, with the user's own VPN app only (Jarchi never ships or picks a public proxy). Many
// streamers run their VPN app per app (split tunneling) without Jarchi on its list; most such apps still have a local
// proxy (HTTP or SOCKS5 on 127.0.0.1), and Jarchi can use it without being on that list. Jarchi never turns a proxy on by
// itself: it only offers. When Kick, Twitch or Jarchi's relay has been out of reach for WAIT_MS (status(): any network trouble, Kick refusing this network (403), or
// still connecting), Jarchi checks the service for real (CHECKS) and, if it fails, looks on this PC for those proxies
// and tests each one by reaching Kick through it. A working one is only offered (the panel's popup: "VPN found: <app>.
// Use it for Jarchi?"); Yes checks Kick and the relay through it, then sets Jarchi's proxy to Manual with it (core/net.js),
// which carries only Jarchi's own connections. No: never asked by itself again (settings.proxyAsk) until the streamer looks
// ("Look for VPN apps", Home's "Fix it").
// A candidate's test sends nothing but a TLS hello for kick.com; Yes's check asks Kick's public API with no login: no
// logins or tokens ever go to a candidate. Afterwards they go only to Kick, Twitch and the relay, inside TLS, as before.
// The panel follows state(): idle | looking | offer { service, found } | checking { found } (Yes: trying Kick and the
// relay through it) | failed { found } (they didn't answer through it) | none { service, system, exe } (nothing found: how
// to let Jarchi through the VPN app; system: a system-wide VPN app that's running; exe: this program's own path, for the
// VPN app's list) | broken { service, proxy } (the proxy in use stopped working: a small warning, Look again). offer and
// none carry test: true when they come from the dev test (trouble).
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const net = require('./net');
const settings = require('./settings');
const { RELAY } = require('../connectors/kick-account');
const { kickGet, PUSHER } = require('../connectors/kick-chat');

const events = new EventEmitter(); // 'state'
const TARGET = 'kick.com'; // what a candidate must reach
const RELAY_HOST = URL.canParse(RELAY) ? new URL(RELAY).hostname : '';
const WAIT_MS = 30 * 1000; // out of reach this long: look (status())
const AUTO_MS = 2 * 60 * 1000; // a connection that keeps failing is checked again at most this often
// Kick's API, without a login: an answer is fine (a 401 or 404 too), but not a 403: Kick refuses this network.
async function kickApi(host, path, via) {
  const { status } = await kickGet(path, { host, via });
  if (status === 403) throw net.fail('blocked');
  if (!status || status >= 500) throw net.fail('network');
}
// Does Jarchi really get to the service (through the proxy setting, or via that proxy)? Throws when it doesn't. The relay
// is the Kick account's way in: the relay itself and Kick's public API.
const CHECKS = {
  kick: async (via) => {
    await kickApi('kick.com', '/api/v2/channels/kick', via);
    await net.reach(new URL(PUSHER).hostname, via);
  },
  twitch: (via) => net.reach('irc-ws.chat.twitch.tv', via),
  relay: async (via) => {
    await net.reach(RELAY_HOST, via);
    await kickApi('api.kick.com', '/public/v1/users', via);
  },
};
const ok = (service, via) => vpn.CHECKS[service](via).then(() => true, () => false);

// VPN apps by their program's name. A core (the part that really listens) is named after the app running it.
const CORE = 'core';
/** @type {[RegExp, string][]} */
const APPS = [
  [/^(xray|v2ray|sing-box|mihomo|verge-mihomo|clash-meta|psiphon-tunnel-core|sslocal|ss-local|hysteria2?|tuic-client|naive|trojan-go|juicity-client)(\.exe)?$/i, CORE],
  [/^v2rayn/i, 'v2rayN'], [/^v2raya/i, 'v2rayA'], [/^nekoray/i, 'NekoRay'], [/^nekobox/i, 'NekoBox'], [/^throne/i, 'Throne'],
  [/^hiddify/i, 'Hiddify'], [/^netmod/i, 'NetMod'], [/^karing/i, 'Karing'], [/^flclash/i, 'FlClash'], [/^mihomo.?party/i, 'Mihomo Party'],
  [/^clash.?verge/i, 'Clash Verge'], [/^clash/i, 'Clash'], [/^outline/i, 'Outline'], [/^psiphon/i, 'Psiphon'],
  [/^shadowsocks/i, 'Shadowsocks'], [/^lantern/i, 'Lantern'], [/^invisible.?man/i, 'Invisible Man'],
];
// Their usual local ports, tried even when the program isn't recognized. Most are "mixed" (either type works).
// ponytail: defaults move between app versions; the program-name match above finds a changed port anyway.
const PORTS = {
  10808: ['v2rayN', 'socks5'], 10809: ['v2rayN', 'http'], 2080: ['NekoBox', 'socks5'], 2081: ['NekoBox', 'http'], 7890: ['Clash', 'http'],
  7891: ['Clash', 'socks5'], 7897: ['Clash Verge', 'http'], 12334: ['Hiddify', 'socks5'], 2334: ['Hiddify', 'socks5'],
  1080: ['Shadowsocks', 'socks5'], 20170: ['v2rayA', 'socks5'], 20171: ['v2rayA', 'http'], 20172: ['v2rayA', 'http'], 3067: ['Karing', 'socks5'],
};
const types = (first) => (first === 'http' ? ['http', 'socks5'] : ['socks5', 'http']);
const appOf = (exe) => APPS.find(([re]) => re.test(exe))?.[1];
// System-wide VPN apps (they route the whole PC, no local proxy) by their programs' names.
/** @type {[RegExp, string][]} */
const SYSTEM = [
  [/^windscribe/i, 'Windscribe'], [/^expressvpn/i, 'ExpressVPN'], [/^nordvpn/i, 'NordVPN'], [/^protonvpn/i, 'Proton VPN'],
  [/^surfshark/i, 'Surfshark'], [/^(cloudflare warp|warp-svc)/i, 'Cloudflare WARP'], [/^mullvad/i, 'Mullvad VPN'],
  [/^cyberghost/i, 'CyberGhost'], [/^hotspot ?shield/i, 'Hotspot Shield'], [/^pia-(client|service)/i, 'Private Internet Access'],
];
// tasklist output -> the first of them running, or null.
function systemVpn(tasks) {
  const running = [...tasks.matchAll(/^"([^"]+)"/gm)].map((m) => m[1]);
  return SYSTEM.find(([re]) => running.some((exe) => re.test(exe)))?.[1] ?? null;
}
// netstat -ano -p TCP: a listening socket on this PC has no remote end ("0.0.0.0:0"); the state word is translated.
const LISTEN = /^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)\s+0\.0\.0\.0:0\s+.*?(\d+)\s*$/gim;
// The same on any IPv4 address of this PC: Windscribe's Proxy Gateway (its Preferences → Connection) listens on the
// PC's LAN address, on a port it picks.
const LISTEN_ANY = /^\s*TCP\s+(\d+\.\d+\.\d+\.\d+):(\d+)\s+0\.0\.0\.0:0\s+.*?(\d+)\s*$/gim;

// netstat + tasklist output and the Windows proxy -> what to try, best first: [{ app, host, port, types }].
// app: the VPN app's name, or null for a Windows proxy no known program serves.
function candidates(netstat, tasks, sys) {
  const exe = new Map([...tasks.matchAll(/^"([^"]+)","(\d+)"/gm)].map((m) => [m[2], m[1]]));
  const owner = new Map([...netstat.matchAll(LISTEN)].map((m) => [Number(m[1]), exe.get(m[2]) ?? '']));
  const gui = [...exe.values()].map(appOf).find((a) => a && a !== CORE);
  const name = (port) => {
    const e = owner.get(port) ?? '', a = appOf(e);
    return (a === CORE ? gui : a) ?? PORTS[port]?.[0] ?? (a === CORE ? e.replace(/\.exe$/i, '') : null);
  };
  const out = new Map();
  const add = (port, host, first, app = name(port)) => out.has(port) || out.set(port, { app, host, port, types: types(first) });
  if (sys && net.LOCAL.test(sys.host)) add(sys.port, sys.host, sys.type); // what the VPN app itself set for Windows
  for (const [port, e] of owner) if (appOf(e)) add(port, '127.0.0.1', 'socks5');
  for (const [, ip, port, pid] of netstat.matchAll(LISTEN_ANY)) {
    if (/^windscribe/i.test(exe.get(pid) ?? '')) add(Number(port), ip === '0.0.0.0' ? '127.0.0.1' : ip, 'socks5', 'Windscribe');
  }
  for (const [port, [, first]] of Object.entries(PORTS)) add(Number(port), '127.0.0.1', first);
  return [...out.values()];
}

// The first candidate (in their order) that really gets through: { app, type, host, port } or null. All are tried at
// once; a port that speaks only one type fails the other at once.
async function firstWorking(list, through) {
  const ok = await Promise.all(list.map(async ({ app, host, port, types }) => {
    for (const type of types) {
      const p = { app, type, host, port };
      if (await through(p).then(() => true, () => false)) return p;
    }
    return null;
  }));
  return ok.find(Boolean) ?? null;
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : out)));
let lastLook = null; // the last look's result: true found one, false none, null no look since Jarchi started
// -> { found: the first working proxy or null, system: a system-wide VPN app running (systemVpn) or null }. Without
// netstat / tasklist (not Windows) only the usual ports are tried. test: not kept for the usage ping (looked()).
async function find(test = false) {
  const [netstat, tasks, sys] = await Promise.all([run('netstat', ['-ano', '-p', 'TCP']), run('tasklist', ['/fo', 'csv', '/nh']), net.windowsProxy()]);
  const found = await firstWorking(candidates(netstat, tasks, sys), (p) => net.reach(TARGET, p));
  if (!test) lastLook = !!found;
  return { found, system: systemVpn(tasks) };
}
// The usage ping's (core/stats.js): did the last look find a proxy; null: no look since Jarchi started.
const looked = () => lastLook;

let st = { state: 'idle' }, busy = false, toldNone = false;
const lastAuto = {}; // service -> when its failure was last checked
const down = {}; // service -> its WAIT_MS timer while it's out of reach
const key = (p) => `${p.type}://${p.host}:${p.port}`;
const EXE = process.execPath; // this program (Jarchi.exe in the desktop app): what a VPN app's own list needs
function set(next) {
  st = next;
  events.emit('state', st);
}

// Each service's connection as it changes (server/index.js). up: connected. out: not, for a reason a VPN can help with
// (network trouble, Kick refusing this network, or still connecting). Neither (off, a channel that isn't there): nothing.
// Out of reach for WAIT_MS on end: trouble().
function status(service, up, out) {
  if (!out || up) {
    clearTimeout(down[service]);
    delete down[service];
    if (up) fine(service);
    return;
  }
  down[service] ??= setTimeout(() => {
    delete down[service];
    trouble(service);
  }, WAIT_MS).unref();
}

// A service out of reach for WAIT_MS, in any mode: checked for real first (it gets there after all: not the network);
// then look, and offer a working VPN proxy (not the one that already fails), or, once per run, say none was found and
// how to let Jarchi through (else, with a proxy in use, the small warning). After a No (settings.proxyAsk false): only
// that small warning. Nothing changes before a Yes. test (Settings' dev-only "Test as
// if Kick were blocked"): as if it can't be reached, in any mode, straight to the look and its popup (offer or none,
// marked test), every time. It leaves nothing behind: no wait before the next real check, the once-per-run "nothing
// found" still to come, no look for the usage ping, a No to its offer not remembered (dismiss). Its popup's Yes is real.
async function trouble(service, test = false) {
  const s = settings.get();
  if (!CHECKS[service] || busy || st.state !== 'idle') return;
  if (!test && Date.now() - (lastAuto[service] ?? 0) < AUTO_MS) return;
  if (!test) lastAuto[service] = Date.now();
  busy = true;
  try {
    if (test) {
      const { found, system } = await vpn.find(true);
      return set(found ? { state: 'offer', service, found, test } : { state: 'none', service, system, exe: EXE, test });
    }
    if (await ok(service)) return;
    const proxy = await net.current();
    if (!s.proxyAsk) return proxy && set({ state: 'broken', service, proxy }); // said No: no popups by itself
    const { found, system } = await vpn.find();
    if (found && !(proxy && key(proxy) === key(found))) set({ state: 'offer', service, found });
    else if (!toldNone) {
      toldNone = true;
      set({ state: 'none', service, system, exe: EXE });
    } else if (proxy) set({ state: 'broken', service, proxy });
  } finally {
    busy = false;
  }
}

// The streamer looks ("Look for VPN apps", "Try again", Home's "Fix it"): the result is always shown, and Jarchi may ask
// by itself again.
function look() {
  if (busy) return st;
  if (!settings.get().proxyAsk) settings.update({ proxyAsk: true }, false);
  busy = true;
  const service = st.service ?? null;
  set({ state: 'looking', service });
  vpn.find().catch(() => ({ found: null, system: null })).then(({ found, system }) => {
    busy = false;
    set(found ? { state: 'offer', service, found } : { state: 'none', service, system, exe: EXE });
  });
  return st;
}

// Yes: Kick and the relay (and the service that failed) are tried through the found proxy; when they answer, Jarchi's
// proxy becomes Manual with it. -> the new settings, or null (nothing to say Yes to, or they didn't answer: state failed).
async function accept() {
  if (st.state !== 'offer') return null;
  const { found, service } = st, via = { type: found.type, host: found.host, port: found.port };
  set({ state: 'checking', service, found });
  const all = (await Promise.all([...new Set(['kick', 'relay', service].filter((x) => CHECKS[x]))].map((x) => ok(x, via)))).every(Boolean);
  if (/** @type {string} */ (st.state) !== 'checking') return null; // answered in another window meanwhile (the cast: tsc can't see st change during the await)
  if (!all) {
    set({ state: 'failed', service, found });
    return null;
  }
  const s = settings.update({ proxyMode: 'manual', proxyType: via.type, proxyHost: via.host, proxyPort: via.port, proxyAsk: true }, false); // its own popup: not a Ctrl+Z step
  fine();
  set({ state: 'idle' }); // the popup closes
  return s;
}

// No / Close. No to an offer: Jarchi doesn't ask by itself any more (until the streamer looks).
function dismiss() {
  if (st.state === 'offer' && !st.test) settings.update({ proxyAsk: false }, false);
  if (!['looking', 'checking'].includes(st.state)) set({ state: 'idle' });
}

// service's connection is up again: what was shown about it goes. No service: the proxy setting changed, so everything
// goes and the next failure is checked at once.
function fine(service) {
  if (!service) for (const k in lastAuto) delete lastAuto[k];
  if ((!service || st.service === service) && ['broken', 'offer', 'none', 'failed'].includes(st.state)) set({ state: 'idle' });
}

// The look and the checks go through the exports, so a test can stand in for this PC's VPN apps and the network.
const vpn = module.exports = { events, state: () => st, status, find, trouble, look, accept, dismiss, fine, looked, candidates, firstWorking, systemVpn, CHECKS, WAIT_MS };
