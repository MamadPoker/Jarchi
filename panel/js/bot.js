// ---------- Bot (core/bot.js talks to TheJarchi, bot.jarchi.app) ----------
// "Coming soon" until the bot is open to this channel. Then: TheJarchi on / off (Jarchi sends it this channel's Kick
// events only while on) and Send a test; the /mod notice until "I did it"; and the thank-you messages, each with its own
// switch and its message as it will read in chat, sample names filled in. Edit: a text box with insert buttons, a live
// preview and the bot's own checks (botWhy), so a text the bot would refuse isn't sent; the bot checks it again.
// The stream-start message isn't here: the bot always sends it.
let botSt = null; // core/bot.js state(): { allowed, on, modded, channel, bot: { on, texts, defaults, placeholders, textMax } | null, error }
let botEdit = null; // the message open in Edit: { type, text } (what's typed so far)
const BOT_TYPES = ['follow', 'sub', 'gift_sub', 'kicks', 'raid'];
const BOT_SAMPLE = { user: 'Sara_Plays', months: 6, count: 5, amount: 100, viewers: 25 }; // what the page shows
const BOT_CHECK = { user: 'someone', months: 12, count: 5, amount: 100, viewers: 20 }; // what the bot checks a text with
const BOT_LINK = /https?:|www\.|[\p{L}\p{N}-]\.\p{L}{2,}|\d+\.\d+\.\d+\.\d+/iu;

const loadBot = () => api('GET', '/api/bot').then(gotBot, (err) => toast(err.message, true));
function gotBot(st) {
  botSt = st;
  renderBot();
}
const showBot = () => (botSt && renderBot(), loadBot());

// What the bot would refuse in a text (its safety.js checkText; blocked words only the bot knows), '' when fine.
// names: the placeholders this message may use; max: the bot's longest text.
function botWhy(text, names, max) {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t) return 'empty';
  if ([...t].length > max) return 'too_long';
  for (const [, n] of t.matchAll(/\{([^{}]*)\}/g)) if (!names.includes(n)) return 'placeholder';
  if (/@(?!\{user\})/.test(t)) return 'mention'; // @{user} thanks the viewer; any other @ pings someone else
  const msg = tpl(t, BOT_CHECK);
  if (/^[/!]/.test(msg)) return 'command';
  if (BOT_LINK.test(msg.normalize('NFKC'))) return 'link';
  return '';
}
const botWhyText = (why) => (S.panel.botWhy[why] ?? S.errors.bot_failed).replace('{max}', String(botSt?.bot?.textMax ?? 200));

// One chat line, as Kick shows it: TheJarchi's name, then the message (with the sample names).
const botLine = (text) =>
  el('p', { className: 'bot-line', dir: 'ltr' }, el('b', { textContent: 'TheJarchi' }), ': ', el('span', { dir: 'auto', textContent: tpl(text, BOT_SAMPLE) }));
const botText = (type) => botSt.bot.texts[type] ?? botSt.bot.defaults[type];

function renderBot() {
  if (!botSt) return;
  const open = botSt.allowed;
  $('.view.bot').classList.toggle('soon', !open);
  $('#botSoon').hidden = open;
  $('#botPage').hidden = !open;
  if (!open) return;
  const b = botSt.bot;
  $('#botDot').classList.toggle('on', botSt.on);
  $('#botState').textContent = S.panel[botSt.on ? 'botIsOn' : 'botIsOff'];
  $('#botOn').checked = botSt.on;
  $('#botTest').disabled = !botSt.on || !b || !BOT_TYPES.some((t) => b.on[t]);
  $('#botError').hidden = !botSt.error;
  $('#botError').textContent = botSt.error ? (S.errors[`bot_${botSt.error}`] ?? S.errors.bot_failed) : '';
  $('#botMod').hidden = botSt.modded;
  $('#botModCopy')?.remove();
  $('#botModCmd').after(Object.assign(copyButton('/mod TheJarchi', $('#botModCmd')), { id: 'botModCopy' }));
  $('#botThanks').hidden = !b;
  if (b) botList();
}

function botList() {
  const b = botSt.bot;
  $('#botList').replaceChildren(
    ...BOT_TYPES.map((type) => {
      const sw = el('input', { type: 'checkbox', checked: b.on[type], onchange: () => botSave({ on: { [type]: sw.checked } }) });
      sw.setAttribute('aria-label', S.panel.botWhen[type]);
      const li = el(
        'li',
        { className: `bot-row${b.on[type] ? '' : ' off'}` },
        el('div', { className: 'bot-row-head' }, el('b', { textContent: S.panel.botWhen[type] }), el('span', { className: 'switch' }, sw, el('span'))),
      );
      const edit = () => {
        botEdit = { type, text: botText(type) };
        botList();
        $('#botList textarea').focus();
      };
      li.append(
        botEdit?.type === type
          ? botEditor(type)
          : el('div', { className: 'bot-row-line' }, botLine(botText(type)), el('button', { className: 'ghost', textContent: S.panel.botEdit, onclick: edit })),
      );
      return li;
    }),
  );
}

// Edit: the text box, insert buttons for what this message may use, the preview and what's wrong, Save / Cancel / Default.
function botEditor(type) {
  const b = botSt.bot,
    names = b.placeholders[type];
  const preview = el('div'),
    why = el('small', { className: 'bot-why' }),
    count = el('small', { className: 'bot-count' });
  const save = el('button', {
    className: 'lk-btn g bt-sm',
    textContent: S.panel.botSave,
    onclick: () => botSave({ texts: { [type]: box.value.trim() === b.defaults[type] ? null : box.value.trim() } }, true),
  });
  const check = () => {
    botEdit.text = box.value;
    const w = botWhy(box.value, names, b.textMax);
    preview.replaceChildren(botLine(box.value.trim() || ' '));
    why.textContent = w ? botWhyText(w) : '';
    count.textContent = `${[...box.value.trim()].length}/${b.textMax}`;
    count.classList.toggle('over', w === 'too_long');
    save.disabled = !!w;
  };
  const box = el('textarea', { className: 'bot-text', rows: 2, dir: 'auto', value: botEdit.text, oninput: check });
  box.setAttribute('aria-label', S.panel.botWhen[type]);
  const insert = (name) =>
    el('button', {
      className: 'ghost bot-ins',
      textContent: `+ ${S.panel.botPh[name]}`,
      onclick: () => {
        box.setRangeText(`{${name}}`, box.selectionStart, box.selectionEnd, 'end');
        box.focus();
        check();
      },
    });
  const reset = () => {
    box.value = b.defaults[type];
    check();
  };
  const cancel = () => {
    botEdit = null;
    botList();
  };
  check();
  return el(
    'div',
    { className: 'bot-editor' },
    box,
    el('div', { className: 'bot-ins-row' }, el('span', { className: 'lk-mini', textContent: S.panel.botInsert }), ...names.map(insert)),
    el('div', { className: 'lk-l', textContent: S.panel.botPreview }),
    preview,
    el('div', { className: 'bot-check' }, why, count),
    el(
      'div',
      { className: 'bot-actions' },
      save,
      el('button', { className: 'ghost', textContent: S.panel.botCancel, onclick: cancel }),
      el('button', { className: 'ghost', textContent: S.panel.botDefault, onclick: reset }),
    ),
  );
}

// A switch or a text, kept by the bot. closing: the editor closes once it's saved. Refused: the page as it was.
async function botSave(body, closing) {
  try {
    const st = await api('PUT', '/api/bot/settings', body);
    if (closing) botEdit = null;
    gotBot(st);
    toast(S.panel.saved);
  } catch (err) {
    toast(err.field ? botWhyText(err.field) : err.message, true);
    renderBot();
  }
}

function wireBot() {
  $('#botOn').onchange = (e) =>
    api('POST', '/api/bot/on', { on: e.target.checked }).then(gotBot, (err) => {
      toast(err.message, true);
      renderBot();
    });
  // Send a test: the first message that's on, from the streamer's own name, in the real chat.
  $('#botTest').onclick = () =>
    api('POST', '/api/bot/test', { type: BOT_TYPES.find((t) => botSt.bot.on[t]) }).then(
      (r) => toast(S.panel[r.skipped ? 'botTestSkipped' : 'botTestSent'], !!r.skipped),
      (err) => (toast(err.message, true), loadBot()),
    );
  $('#botModDone').onclick = () => api('POST', '/api/bot/modded').then(gotBot, (err) => toast(err.message, true));
}
