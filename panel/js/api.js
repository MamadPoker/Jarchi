async function api(method, url, body, headers = {}) {
  const isFile = body instanceof Blob || body instanceof FormData;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'x-jarchi': '1', ...(body && !isFile && { 'content-type': 'application/json' }), ...headers },
      body: isFile ? body : body && JSON.stringify(body),
    });
  } catch {
    throw new Error(S.errors.offline);
  }
  const data = await res.json().catch(() => ({ error: 'server_error' }));
  if (!res.ok) throw Object.assign(new Error(S.errors[data.error] || S.errors.server_error), { field: data.field }); // field: which one is wrong
  return data;
}

let toastTimer;
// undoable: "Saved" with an Undo link after it (a little longer, to reach it).
function toast(msg, isError, undoable) {
  const t = $('#toast');
  ($('dialog[open]') ?? document.body).append(t); // over an open dialog's backdrop, not under it
  t.textContent = msg;
  if (undoable) t.append(' · ', el('button', { className: 'link', textContent: S.panel.undo, onclick: () => undoRedo('undo') }));
  t.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), undoable ? 4000 : 2000);
}

// Any call that returns settings: store them, re-sync the UI (also reverts rejected values), replay the preview.
async function send(method, url, body, headers) {
  try {
    settings = await api(method, url, body, headers);
    if (view === 'chat') {
      // the Chat page's own "Saved" note lights up instead of the toast
      const note = $('#chatSaved');
      note.classList.remove('flash');
      void note.offsetWidth; // restart its animation
      note.classList.add('flash');
    } else toast(S.panel.saved, false, settings.canUndo);
    preview();
  } catch (err) {
    toast(err.message, true);
  }
  render();
}
const patchAlert = (type, fields) => send('PATCH', '/api/settings', { alerts: { [type]: fields } });
const patchGoal = (id, fields) => send('PATCH', '/api/settings', { goals: { [id]: fields } });
const patchViewers = (fields) => send('PATCH', '/api/settings', { viewers: fields });
// The selected chat's settings; the channels are Chat 1's.
const patchChat = (fields) => send('PATCH', '/api/settings', { ['kickChannel' in fields || 'twitchChannel' in fields ? 'chat' : curChat]: fields });
// Undo / redo a settings change (the server keeps the last 5 while Jarchi runs): Ctrl+Z / Ctrl+Y, and the "Saved" note's
// Undo. On the Chat page, a step that changed only the other chat opens that one, so the change is in view.
async function undoRedo(s) {
  const was = settings;
  await send('POST', `/api/settings/${s}`);
  const other = curChat === 'chat' ? 'chat2' : 'chat';
  const same = (k) => JSON.stringify(was[k]) === JSON.stringify(settings[k]);
  if (view === 'chat' && settings[other] && same(curChat) && !same(other)) select('chat', other);
}

// Change a goal's count (the selected one's by default): { add: n } or { set: n }.
async function goalCount(body, id = curGoal) {
  try {
    goalData.state = await api('PATCH', `/api/goals/${id}`, body);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

// A goal's row in the Goals list: its count (click it and type another), "/ target", and Reset to 0 (click twice).
function goalCountRow(id) {
  const input = el('input', {
    type: 'number',
    min: 0,
    step: 1,
    className: 'count-input',
    onchange: () => goalCount({ set: Math.max(0, Math.round(Number(input.value) || 0)) }, id),
  });
  input.setAttribute('aria-label', `${goalName(id)}: ${S.panel.goalCurrent}`);
  const zero = el('button', { className: 'ghost zero', textContent: S.panel.goalZero });
  twoClick(zero, zero, S.panel.goalZero, S.panel.confirmZero, () => goalCount({ set: 0 }, id));
  // Synced from Kick / Twitch: their count, read-only, without Reset to 0 (the tab already says which platform).
  return el('div', { className: 'goal-count' }, input, el('small', { className: 'of' }), zero);
}
