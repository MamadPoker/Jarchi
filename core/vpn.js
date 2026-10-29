// Help for filtered networks, with the user's own VPN app only (Jarchi never ships or picks a public proxy): when Kick,
// Twitch or Jarchi's relay can't be reached, look on this PC for a VPN app's local proxy (HTTP or SOCKS5 on 127.0.0.1)
// and test each one by really reaching Kick through it. A working one is only offered (the panel asks "Connect Jarchi
// through it?"); Yes saves it as the auto proxy (core/net.js), which carries only Jarchi's own connections.
// A test sends nothing but a TLS hello for kick.com: no logins or tokens ever go to a candidate. Afterwards they go only
// to Kick, Twitch and the relay, inside TLS, as before.
// The panel follows state(): idle | looking (the user asked) | offer { service, found } | none { service, system }
// (nothing found; system: a system-wide VPN app that's running, so it's likely leaving Jarchi out: Split Tunneling) |
// broken { service, proxy } (the proxy in use stopped working: a small warning, Look again).
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const net = require('./net');
const settings = require('./settings');
const { RELAY } = require('../connectors/kick-account');

const events = new EventEmitter(); // 'state'
const TARGET = 'kick.com'; // what a candidate must reach
const HOSTS = { kick: 'kick.com', twitch: 'irc-ws.chat.twitch.tv', relay: URL.canParse(RELAY) ? new URL(RELAY).hostname : '' };
const AUTO_MS = 2 * 60 * 1000; // a connection that keeps failing is checked again at most this often

// VPN apps by their program's name. A core (the part that really listens) is named after the app running it.
const CORE = 'core';
const APPS = [
  [/^(xray|v2ray|sing-box|mihomo|verge-mihomo|clash-meta|psiphon-tunnel-core|sslocal|hysteria2?|tuic-client|naive)(\.exe)?$/i, CORE],
  [/^v2rayn/i, 'v2rayN'], [/^nekoray/i, 'NekoRay'], [/^nekobox/i, 'NekoBox'], [/^hiddify/i, 'Hiddify'], [/^netmod/i, 'NetMod'],
  [/^clash.?verge/i, 'Clash Verge'], [/^clash/i, 'Clash'], [/^outline/i, 'Outline'], [/^psiphon/i, 'Psiphon'],
  [/^shadowsocks/i, 'Shadowsocks'], [/^lantern/i, 'Lantern'],
];
// Their usual local ports, tried even when the program isn't recognized. Most are "mixed" (either type works).
// ponytail: defaults move between app versions; the program-name match above finds a changed port anyway.
const PORTS = {
  10808: ['v2rayN', 'socks5'], 10809: ['v2rayN', 'http'], 2080: ['NekoBox', 'socks5'], 7890: ['Clash', 'http'],
  7891: ['Clash', 'socks5'], 7897: ['Clash Verge', 'http'], 12334: ['Hiddify', 'socks5'], 1080: ['Shadowsocks', 'socks5'],
};
const types = (first) => (first === 'http' ? ['http', 'socks5'] : ['socks5', 'http']);
const appOf = (exe) => APPS.find(([re]) => re.test(exe))?.[1];
// System-wide VPN apps (they route the whole PC, no local proxy) by their programs' names.
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
// netstat / tasklist (not Windows) only the usual ports are tried.
async function find() {
  const [netstat, tasks, sys] = await Promise.all([run('netstat', ['-ano', '-p', 'TCP']), run('tasklist', ['/fo', 'csv', '/nh']), net.windowsProxy()]);
  const found = await firstWorking(candidates(netstat, tasks, sys), (p) => net.reach(TARGET, p));
  lastLook = !!found;
  return { found, system: systemVpn(tasks) };
}
// The usage ping's (core/stats.js): did the last look find a proxy; with none since Jarchi started, true if one was
// said Yes to before (only a look finds one), else null.
const looked = () => lastLook ?? (settings.get().proxyFound ? true : null);

let st = { state: 'idle' }, busy = false, toldNone = false;
const lastAuto = {}; // service -> when its failure was last checked
const declined = new Set(); // proxies the user said No to, not offered again by themselves (until Jarchi restarts)
const key = (p) => `${p.type}://${p.host}:${p.port}`;
function set(next) {
  st = next;
  events.emit('state', st);
}

// A connection failed (server/index.js: Kick / Twitch / relay status). Reachable after all: not the network, nothing to
// do. Else, with a proxy in use: it stopped working (warning). Without one: look, and offer what works (or, once per
// run, say nothing was found, and which system-wide VPN app is running). test (Settings' dev-only "Test as if Kick
// were blocked"): as if it can't be reached, every time, even with the proxy Off, offering again what was declined.
async function trouble(service, test = false) {
  if ((!test && settings.get().proxyMode === 'off') || busy || st.state !== 'idle' || !HOSTS[service] || (!test && Date.now() - (lastAuto[service] ?? 0) < AUTO_MS)) return;
  lastAuto[service] = Date.now();
  busy = true;
  try {
    if (!test && await net.reach(HOSTS[service]).then(() => true, () => false)) return;
    const proxy = await net.current();
    if (proxy) return set({ state: 'broken', service, proxy });
    const { found, system } = await find();
    if (found && (test || !declined.has(key(found)))) set({ state: 'offer', service, found });
    else if (!found && (test || !toldNone)) {
      toldNone = true;
      set({ state: 'none', service, system });
    }
  } finally {
    busy = false;
  }
}

// The panel's "Look for VPN apps" / "Look again": the result is offered even if it was declined before.
function look() {
  if (busy) return st;
  busy = true;
  const service = st.service ?? null;
  set({ state: 'looking', service });
  find().catch(() => ({ found: null, system: null })).then(({ found, system }) => {
    busy = false;
    set(found ? { state: 'offer', service, found } : { state: 'none', service, system: service && system }); // the hint only after a failure
  });
  return st;
}

// Yes: the found proxy becomes the auto proxy. -> the new settings, or null when there's nothing to say Yes to.
function accept() {
  if (st.state !== 'offer') return null;
  const { app, type, host, port } = st.found;
  const s = settings.update({ proxyMode: 'auto', proxyFound: { app, type, host, port } });
  fine();
  return s;
}

// No / Close.
function dismiss() {
  if (st.state === 'offer') declined.add(key(st.found));
  if (st.state !== 'looking') set({ state: 'idle' });
}

// service's connection is up again: what was shown about it goes. No service: the proxy setting changed, so everything
// goes and the next failure is checked at once.
function fine(service) {
  if (!service) for (const k in lastAuto) delete lastAuto[k];
  if ((!service || st.service === service) && ['broken', 'offer', 'none'].includes(st.state)) set({ state: 'idle' });
}

module.exports = { events, state: () => st, trouble, look, accept, dismiss, fine, looked, candidates, firstWorking, systemVpn };
