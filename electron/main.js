// Jarchi as a desktop app: the same server as `npm start`, in its own process, plus a window for the panel and a tray
// icon. Closing the window only hides it, so alerts and chat keep running for OBS until Quit. No GPU switches here:
// the window renders like Chrome does, on the GPU Windows picks for it.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { app, BrowserWindow, Tray, Menu, Notification, clipboard, dialog, ipcMain, safeStorage, screen, shell, utilityProcess } = require('electron');

const ROOT = path.join(__dirname, '..');
// From source the data stays in ./data like `npm start`; an installed app keeps it in the user's app data folder.
if (app.isPackaged) process.env.JARCHI_DATA_DIR ||= path.join(app.getPath('userData'), 'data');
const { HOST, PORT, DATA_DIR } = require('../core/config');
const { parse } = require('../core/changelog');
const ORIGIN = `http://${HOST}:${PORT}`;
const WINDOW_FILE = path.join(DATA_DIR, 'window.json');

let win,
  tray,
  server,
  quitting = false;

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Last size and position; the position is dropped when it's on no screen any more (a monitor unplugged since).
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(WINDOW_FILE, 'utf8'));
    const onScreen = screen
      .getAllDisplays()
      .some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
    return onScreen ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch {
    return { width: 1280, height: 820 };
  }
}
function saveBounds() {
  try {
    fs.writeFileSync(WINDOW_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {}
}

// Outside websites open in the normal browser (only http/https, nothing else gets handed to the system);
// Jarchi's own pages stay in the app.
const own = (url) => URL.canParse(url) && new URL(url).origin === ORIGIN;
const outside = (url) => /^https?:/i.test(url) && shell.openExternal(url);

// The title bar is the panel's own (panel.css .titlebar: the logo and the name, for dragging the window); Windows keeps
// its minimize / maximize / close buttons on it, in the bar's color, which the panel gives as its theme-color on every
// look change. Symbols: black on a light bar, white on a dark one.
const BAR = { height: 36, color: '#0c1817', symbolColor: '#ffffff' }; // until the panel says (Jarchi's dark sidebar)
function tintBar(w, color) {
  if (!color || process.platform === 'darwin' || w.isDestroyed()) return; // macOS keeps its own traffic lights
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  w.setTitleBarOverlay({ color, symbolColor: 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff' });
}

// Crypto's pop-out (panel/crypto-popout.html): the donations list alone, small, for a second monitor. Its pin keeps it
// on top of other windows (preload.js onTop).
const POPOUT = {
  width: 380,
  height: 600,
  minWidth: 300,
  minHeight: 300,
  autoHideMenuBar: true,
  icon: path.join(ROOT, 'assets/brand/icons', process.platform === 'win32' ? 'jarchi.ico' : 'jarchi-256.png'),
  webPreferences: { preload: path.join(__dirname, 'preload.js') },
};
// The Luck page's pop-out (the panel at /?pop=luck): the whole page, with its tabs as the title bar (panel.css data-pop,
// 46 px like this overlay) and Always on top (onTop).
const LUCK_POP = { ...POPOUT, width: 1180, height: 820, minWidth: 720, minHeight: 560, titleBarStyle: 'hidden', titleBarOverlay: { ...BAR, height: 46 } };
const popOf = (url) => (new URL(url).pathname === '/crypto-popout.html' ? POPOUT : new URL(url).searchParams.get('pop') === 'luck' ? LUCK_POP : null);
ipcMain.on('window:onTop', (e, on) => BrowserWindow.fromWebContents(e.sender)?.setAlwaysOnTop(on === true));

// Right-click, in every window (the panel, Crypto's pop-out): Electron has none of its own. In a text field: Cut, Copy,
// Paste, Select all (Cut and Copy only with text selected, Paste only with something to paste); on selected text
// elsewhere: Copy. In the panel's language (i18n panel.editMenu). The keys (Ctrl+X / C / V / A) work as they always do.
const editWords = {};
const wordsOf = (lang) => (editWords[lang] ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', `${lang}.json`), 'utf8')).panel.editMenu);
app.on('web-contents-created', (e, wc) =>
  wc.on('context-menu', async (ev, p) => {
    const selected = p.selectionText.trim() !== '';
    if (!p.isEditable && !selected) return;
    const lang = await wc.executeJavaScript("localStorage.getItem('jarchi.lang')").catch(() => null);
    const W = wordsOf(lang === 'fa' ? 'fa' : 'en'),
      f = p.editFlags;
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const items = p.isEditable
      ? [
          { role: 'cut', label: W.cut, enabled: selected && f.canCut },
          { role: 'copy', label: W.copy, enabled: selected && f.canCopy },
          { role: 'paste', label: W.paste, enabled: f.canPaste },
          { type: 'separator' },
          { role: 'selectAll', label: W.selectAll, enabled: f.canSelectAll },
        ]
      : [{ role: 'copy', label: W.copy }];
    if (!wc.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined });
  }),
);

function open() {
  const { maximized, ...bounds } = savedBounds();
  win = new BrowserWindow({
    ...bounds,
    title: 'Jarchi',
    icon: path.join(ROOT, 'assets/brand/icons', process.platform === 'win32' ? 'jarchi.ico' : 'jarchi-256.png'), // the logo, square: every size sharp
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: BAR,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.webContents.on('did-change-theme-color', (e, color) => tintBar(win, color));
  win.webContents.on('did-finish-load', sendUpdate);
  win.on('page-title-updated', (e) => e.preventDefault()); // the panel names its tab; the window stays "Jarchi"
  win.once('ready-to-show', () => (maximized ? win.maximize() : win.show()));
  win.on('close', (e) => {
    saveBounds();
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (own(url)) return { action: 'allow', ...(popOf(url) && { overrideBrowserWindowOptions: popOf(url) }) };
    outside(url);
    return { action: 'deny' };
  });
  // Luck's pop-out has the panel's title bar: its window buttons take the bar's color too.
  win.webContents.on('did-create-window', (child, { url }) => {
    if (popOf(url) === LUCK_POP) child.webContents.on('did-change-theme-color', (e, color) => tintBar(child, color));
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (own(url)) return;
    e.preventDefault();
    outside(url);
  });
  win.loadURL(`${ORIGIN}/`);

  tray = new Tray(path.join(ROOT, 'assets/brand/icons', process.platform === 'win32' ? 'jarchi.ico' : 'jarchi-32.png'));
  tray.setToolTip('Jarchi');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Jarchi', click: show },
      { label: 'Copy OBS alerts link', click: () => clipboard.writeText(`${ORIGIN}/widgets/alerts`) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', show); // right click: the menu
  tray.on('double-click', show);
}

// Updates, only in the installed app (`npm run app` has none): electron-updater looks for a newer release on GitHub
// (package.json build.publish, built into the app's app-update.yml: MamadPoker/Jarchi from v1.0.2; v1.0.1 and before
// look on MamadPoker/Jarchi-releases, which has v1.0.2 too) at start, every 30 minutes and on the About page's Check
// for updates, and downloads it in the background. It's installed only on Restart (the panel's banner or profile menu,
// About, or the notification shown while the window is in the tray), never by itself while Jarchi runs; quitting Jarchi
// installs it without starting it again (electron-updater's autoInstallOnAppQuit).
// The panel gets { ready, installed } (preload.js): ready = the downloaded update { version, notes: { en, fa } } (its
// release notes, core/changelog.js), installed = the update this copy came from, until the panel has opened What's new.
// NOTES_FILE carries it over the restart. The installed app's also has check: what Check for updates came to (idle |
// checking | downloading | latest | error), so the About page shows the button only there.
const NOTES_FILE = path.join(DATA_DIR, 'update.json');
const update = { ready: null, installed: null };
let updater;

function sendUpdate() {
  win?.webContents.send('update', update);
}

// Update checks and downloads go the way Jarchi's own connections do (its proxy setting, core/net.js), asked from the
// server before each check: 'socks5://127.0.0.1:10808' or null (direct). Only electron-updater's own session gets it,
// nothing else on the PC.
function serverProxy() {
  return new Promise((resolve) => {
    if (!server) return resolve(null);
    const done = (proxy) => {
      clearTimeout(late);
      server?.off('message', got);
      resolve(proxy);
    };
    const got = (m) => m?.proxy !== undefined && done(m.proxy);
    const late = setTimeout(done, 3000, null);
    server.on('message', got);
    server.postMessage('proxy');
  });
}
const restart = () => updater.quitAndInstall(true, true); // silent install, then Jarchi starts again

async function notify(version) {
  const lang = await win.webContents.executeJavaScript("localStorage.getItem('jarchi.lang')").catch(() => null);
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', `${lang === 'fa' ? 'fa' : 'en'}.json`), 'utf8'));
  const n = new Notification({ title: 'Jarchi', body: S.panel.updateNotice.replace('{version}', version) });
  n.on('click', restart);
  n.show();
}

function updates() {
  app.setAppUserModelId('com.mamadpoker.jarchi'); // package.json build.appId: the Start menu shortcut's, so Windows shows the notification
  try {
    const saved = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
    if (saved.version === app.getVersion()) update.installed = saved;
  } catch {}
  update.check = 'idle';
  ipcMain.on('update:restart', restart);
  ipcMain.on('update:check', () => check(true));
  ipcMain.on('update:seen', () => {
    update.installed = null;
    if (!update.ready) fs.rmSync(NOTES_FILE, { force: true }); // else it holds the next update's notes by now
    sendUpdate();
  });

  ({ autoUpdater: updater } = require('electron-updater'));
  const { getNetSession } = require('electron-updater/out/electronHttpExecutor'); // the session its requests use
  updater.on('error', (err) => console.warn('Update:', err.message)); // offline, GitHub down: the next check tries again
  updater.on('update-downloaded', ({ version, releaseNotes }) => {
    if (update.ready?.version === version) return; // each later check finds the same download again
    update.ready = { version, notes: parse(typeof releaseNotes === 'string' ? releaseNotes : '') };
    try {
      fs.writeFileSync(NOTES_FILE, JSON.stringify(update.ready));
    } catch {}
    sendUpdate();
    if (!win.isVisible()) notify(version);
  });
  // asked: Check for updates, so the About page shows how it went; the timed checks stay quiet.
  async function check(asked) {
    const say = (s) => asked && ((update.check = s), sendUpdate());
    say('checking');
    const proxy = await serverProxy();
    await getNetSession()
      .setProxy(proxy ? { mode: 'fixed_servers', proxyRules: proxy } : { mode: 'direct' })
      .catch(() => {});
    try {
      const found = await updater.checkForUpdates();
      if (!found?.isUpdateAvailable) return say('latest');
      say('downloading');
      await found.downloadPromise;
      say('idle'); // 'update-downloaded' has set update.ready by now: About shows its Restart
    } catch {
      say('error'); // offline, GitHub down
    }
  }
  check();
  setInterval(check, 30 * 60e3);
}

// Settings > Uninstall Jarchi, only in the installed app: the installer's uninstaller next to Jarchi.exe (not there
// with `npm run app` or a build that was never installed). It's told whether to keep the data (build/installer.nsh), so
// it doesn't ask again, and Jarchi quits so it can remove the files, without installing a downloaded update first.
const UNINSTALLER = path.join(path.dirname(process.execPath), 'Uninstall Jarchi.exe');
const installed = () => app.isPackaged && fs.existsSync(UNINSTALLER);
ipcMain.handle('app:installed', installed);
ipcMain.on('app:uninstall', (e, keep) => {
  if (!installed()) return;
  spawn(UNINSTALLER, [keep ? '--keep-app-data' : '--delete-app-data'], { detached: true, stdio: 'ignore' }).unref();
  if (updater) updater.autoInstallOnAppQuit = false;
  app.quit();
});

// The installed app's key for the Kick and Twitch logins in its data folder (core/secrets.js seals them with it):
// random, kept in KEY_FILE encrypted by Electron safeStorage (Windows DPAPI: only this Windows user on this PC can read
// it), handed to the server process in its environment. One that can't be read any more (the folder copied to another
// PC or Windows user) is moved aside for a new one: the logins sealed with it need connecting again, nothing else is
// lost. No safeStorage, or a new key can't be saved: no key, the logins stay plain text as in a dev run. Windows'
// own key moved on (shouldReEncrypt): the same key is saved again with the new one.
const KEY_FILE = path.join(DATA_DIR, 'secrets.key');
async function secretKey() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return '';
  let key,
    fresh = false;
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(KEY_FILE));
    if (!shouldReEncrypt) return result;
    key = result;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`secrets.key unreadable (${err.message}): moved aside, Kick and Twitch need connecting again`);
      try {
        fs.renameSync(KEY_FILE, `${KEY_FILE}.broken-${Date.now()}`);
      } catch {}
    }
    key = crypto.randomBytes(32).toString('base64');
    fresh = true;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, await safeStorage.encryptStringAsync(key));
  } catch {
    if (fresh) return ''; // never a key that isn't saved: the next start couldn't open what it sealed
  }
  return key;
}

if (!app.requestSingleInstanceLock())
  app.quit(); // one Jarchi at a time: the first one shows its window instead
else {
  app.on('second-instance', show);
  // Quitting waits for the server's last usage ping (core/stats.js; none without the Privacy Policy), 2.5 s at most.
  let bye = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (bye || !server) return;
    bye = true;
    e.preventDefault();
    const go = () => {
      clearTimeout(late);
      app.quit();
    };
    const late = setTimeout(go, 2500);
    server.on('message', (m) => m === 'bye' && go());
    server.postMessage('quit');
  });
  app.whenReady().then(async () => {
    const key = app.isPackaged ? await secretKey() : '';
    // In its own process, the server's work (chat, alerts, files, the widgets' requests) never holds up the window. It
    // says when it's listening. If it stops (e.g. `npm start` already has the port), so does the app, with the server's
    // last error lines in a message: there's no console here.
    // Its output is piped, never 'inherit': started from a shortcut, Jarchi has no stdout, and handing that missing
    // handle to the server crashes the app at once (Chromium: "Check failed: The handle is invalid"). Echoed, it shows
    // in a terminal as before; with no console, Node drops it. JARCHI_INSTALLED: the usage ping says installed app or not.
    // JARCHI_SECRET_KEY: the logins' key, in the installed app only (`npm run app` shares ./data with `npm start`).
    server = utilityProcess.fork(path.join(ROOT, 'server/index.js'), [], {
      serviceName: 'Jarchi server',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, JARCHI_INSTALLED: installed() ? '1' : '', JARCHI_SECRET_KEY: key },
    });
    server.stdout.on('data', (d) => process.stdout.write(d));
    let errors = '';
    server.stderr.on('data', (d) => {
      process.stderr.write(d);
      errors = (errors + d).slice(-1500);
    });
    server.once('message', () => {
      open();
      if (app.isPackaged) updates();
    });
    server.on('exit', (code) => {
      server = null;
      if (quitting) return;
      dialog.showErrorBox('Jarchi', `Jarchi stopped (code ${code}).\n\n${errors}`.trim());
      app.quit();
    });
  });
}
