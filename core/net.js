// Every outgoing connection (Kick, Twitch, 7TV, and the emote / badge / avatar images widgets load through /remote)
// goes through tunnel() here, so the proxy setting covers all of them:
//   off     direct
//   system  the Windows proxy (Settings > Network > Proxy, what VPN apps set), read from the registry
//   manual  an HTTP or SOCKS5 proxy at host:port
// fetch() and WebSocket use it through the global undici dispatcher set below; Kick's HTTP/2 lookups call secure().
const net = require('node:net');
const tls = require('node:tls');
const { execFile } = require('node:child_process');
const { Agent, setGlobalDispatcher } = require('undici');
const settings = require('./settings');

const TIMEOUT = 10000;
const REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
let sys = { at: 0, proxy: null };

// "127.0.0.1:10809", "http://[::1]:8080" -> { host, port }.
function hostPort(v) {
  const m = /^(?:\w+:\/\/)?\[?([^\]\s]+?)\]?:(\d{1,5})\/?$/.exec(v.trim());
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

// Windows' ProxyServer is "host:port" for everything, or per scheme: "http=h:p;https=h:p;socks=h:p".
function parseWindows(enable, server) {
  if (!enable || !server) return null;
  if (!server.includes('=')) return { type: 'http', ...hostPort(server) };
  const by = Object.fromEntries(server.split(';').map((kv) => kv.split('=').map((s) => s.trim().toLowerCase())));
  for (const [scheme, type] of [['https', 'http'], ['http', 'http'], ['socks', 'socks5']]) {
    const hp = by[scheme] && hostPort(by[scheme]);
    if (hp) return { type, ...hp };
  }
  return null;
}

// ponytail: PAC scripts (AutoConfigURL) and the bypass list are ignored; we only ever connect to public sites.
function windowsProxy() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (Date.now() - sys.at < 15000) return Promise.resolve(sys.proxy); // VPN apps switch it on and off, so look again often
  return new Promise((resolve) => {
    execFile('reg', ['query', REG], { windowsHide: true, timeout: 3000 }, (err, out = '') => {
      const val = (name) => new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, 'mi').exec(out)?.[1].trim();
      const proxy = err ? null : parseWindows(Number(val('ProxyEnable')) === 1, val('ProxyServer'));
      sys = { at: Date.now(), proxy: proxy?.host ? proxy : null };
      resolve(sys.proxy);
    });
  });
}

// The proxy to use now: { type: 'http' | 'socks5', host, port } or null (direct).
async function current() {
  const s = settings.get();
  if (s.proxyMode === 'manual') return s.proxyHost && s.proxyPort ? { type: s.proxyType, host: s.proxyHost, port: s.proxyPort } : null;
  return s.proxyMode === 'system' ? windowsProxy() : null;
}

const fail = (code, message) => Object.assign(new Error(message ?? code), { code });

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.setTimeout(TIMEOUT, () => s.destroy(fail('ETIMEDOUT', 'timeout')));
    s.once('connect', () => { s.setTimeout(0); s.off('error', reject).on('error', () => {}); resolve(s); }); // later errors reach TLS / undici
    s.once('error', reject);
  });
}

// The proxy's reply during a handshake: bytes collect until size(buf) says how long the reply is (0 = need more).
function reply(sock, size) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const done = (err, v) => {
      sock.off('data', onData).off('error', done).off('close', closed);
      sock.setTimeout(0);
      sock.pause(); // TLS takes over the socket next
      err ? reject(err) : resolve(v);
    };
    const closed = () => done(fail('proxy_refused', 'proxy closed the connection'));
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const n = size(buf);
      if (n) done(null, buf.subarray(0, n));
    };
    sock.setTimeout(TIMEOUT, () => done(fail('ETIMEDOUT', 'proxy timeout')));
    sock.on('data', onData).once('error', done).once('close', closed);
    sock.resume(); // the previous reply paused it
  });
}

async function httpConnect(sock, host, port) {
  const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
  sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  const head = (await reply(sock, (b) => { const i = b.indexOf('\r\n\r\n'); return i < 0 ? 0 : i + 4; })).toString('latin1');
  if (!/^HTTP\/1\.[01] 2\d\d/.test(head)) throw fail('proxy_refused', `proxy answered: ${head.split('\r\n')[0]}`);
}

// ponytail: no proxy username/password (local VPN apps don't use one); add RFC 1929 auth if someone needs it.
async function socks5(sock, host, port) {
  sock.write(Buffer.from([5, 1, 0]));
  const hello = await reply(sock, (b) => (b.length >= 2 ? 2 : 0));
  if (hello[0] !== 5 || hello[1] !== 0) throw fail('proxy_refused', 'SOCKS5 proxy wants a login');
  const name = Buffer.from(host);
  sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]));
  const r = await reply(sock, (b) => {
    if (b.length < 5) return 0;
    const n = { 1: 10, 4: 22, 3: 7 + b[4] }[b[3]] ?? 2;
    return b.length >= n ? n : 0;
  });
  if (r[1] !== 0) throw fail(r[1] === 4 ? 'ENOTFOUND' : 'proxy_refused', `SOCKS5 error ${r[1]}`);
}

// A TCP socket to host:port, through the proxy when there is one (never for this PC itself).
// Proxy errors are tagged 'proxy_down' / 'proxy_refused'.
const LOCAL = /^(localhost|127(\.\d+){3}|::1)$/i;
async function tunnel(host, port) {
  const p = LOCAL.test(host) ? null : await current();
  if (!p) return connect(host, port);
  const sock = await connect(p.host, p.port).catch((err) => { throw fail('proxy_down', `can't reach the proxy at ${p.host}:${p.port} (${err.code ?? err.message})`); });
  try {
    await (p.type === 'socks5' ? socks5(sock, host, port) : httpConnect(sock, host, port));
  } catch (err) {
    sock.destroy();
    throw err;
  }
  return sock;
}

// A TLS socket to host:port (through the proxy), offering the given ALPN protocols ('h2' for Kick's API).
async function secure(host, port, alpn) {
  const raw = await tunnel(host, port);
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket: raw, servername: host, ALPNProtocols: alpn });
    const failed = (err) => { raw.destroy(); reject(err); };
    s.setTimeout(TIMEOUT, () => s.destroy(fail('ETIMEDOUT', 'timeout'))); // filtered networks often drop the TLS hello
    s.once('secureConnect', () => { s.setTimeout(0); s.off('error', failed); resolve(s); });
    s.once('error', failed);
  });
}

// fetch() and WebSocket everywhere in the app connect through tunnel().
setGlobalDispatcher(new Agent({
  connect(opts, cb) {
    const https = opts.protocol === 'https:' || opts.protocol === 'wss:';
    const port = Number(opts.port) || (https ? 443 : 80);
    (https ? secure(opts.hostname, port, ['http/1.1']) : tunnel(opts.hostname, port)).then((s) => cb(null, s), (err) => cb(err, null));
  },
}));

// Can we reach host:443 (TCP + TLS, through the proxy)? Throws like secure().
const reach = (host) => secure(host, 443, ['http/1.1']).then((s) => s.destroy());

// An error -> what the panel says about it: proxy_down | proxy_refused | dns | timeout | network.
function why(err) {
  const c = err?.code ?? err?.cause?.code;
  if (c === 'proxy_down' || c === 'proxy_refused' || c === 'blocked') return c;
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'dns';
  if (c === 'ETIMEDOUT' || c === 'UND_ERR_CONNECT_TIMEOUT' || err?.name === 'TimeoutError') return 'timeout';
  return 'network'; // reset, refused, TLS failure: usually a filtered network
}

module.exports = { tunnel, secure, reach, why, fail, current, windowsProxy, parseWindows };
