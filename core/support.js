// Support tickets (the panel's Support page), kept on Jarchi's relay (relay/worker.mjs /support), only once the Privacy
// Policy is accepted. The relay knows this install by its id and its ticket token (settings.supportToken(): made for the
// first ticket, sent only to the relay, never to the panel). The panel's forms (a new ticket, a message, with
// screenshots the panel already made small) go on as they are: the relay checks them.
const settings = require('./settings');
const stats = require('./stats');
const { RELAY } = require('../connectors/kick-account');

// The relay's addresses Jarchi uses (nothing else gets this install's token).
const PATH = /^\/support\/tickets(?:\/[0-9A-F]{8}(?:\/messages|\/images\/[0-9a-f]{32}\.(?:png|jpg|webp))?)?$/;
// The relay's errors the panel has words for (i18n errors.support_<code>); any other is support_failed.
const ERRORS = ['not_found', 'bad_image', 'image_too_large', 'too_many_images', 'too_large', 'closed', 'ticket_limit', 'message_limit', 'storage'];
const failed = (status, code) => Object.assign(new Error(code), { status, code: `support_${code}` });

// One call to the relay -> its answer (a Response, ok). Throws { status, code } for the panel: support_privacy,
// support_offline (no answer: offline, a proxy, the relay down) or the relay's error.
async function call(method, path, body, type) {
  if (!PATH.test(path)) throw failed(404, 'not_found');
  if (!stats.accepted()) throw failed(403, 'privacy');
  const list = method === 'GET' && path === '/support/tickets';
  const token = settings.supportToken(!list);
  if (!token && list) return Response.json([]); // never a ticket (or its token can't be opened here): nothing to ask
  if (!token) throw failed(403, 'failed'); // sealed with a key this run doesn't have: no new one over it
  const ask = () => fetch(`${RELAY}${path}`, {
    method, body, signal: AbortSignal.timeout(body ? 60000 : 15000),
    headers: { 'x-jarchi-install': settings.installId(), authorization: `Bearer ${token}`, ...(body && { 'content-type': type }) },
  });
  let r;
  try {
    r = await ask();
    // The relay doesn't know this install yet (its pings failed, or its row was deleted there): a ping, then once more.
    if (r.status === 403 && (await r.clone().json().catch(() => ({}))).error === 'unknown_install') {
      await stats.ping();
      r = await ask();
    }
  } catch {
    throw failed(502, 'offline');
  }
  if (r.ok) return r;
  const { error } = await r.json().catch(() => ({}));
  throw failed(r.status >= 500 ? 502 : 400, ERRORS.includes(error) ? error : 'failed');
}

module.exports = { call };
