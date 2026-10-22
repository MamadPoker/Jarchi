// Jarchi as a desktop app: the same server as `npm start`, in its own process, plus a window for the panel and a tray
// icon. Closing the window only hides it, so alerts and chat keep running for OBS until Quit. No GPU switches here:
// the window renders like Chrome does, on the GPU Windows picks for it.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, clipboard, dialog, screen, shell, utilityProcess } = require('electron');

const ROOT = path.join(__dirname, '..');
// From source the data stays in ./data like `npm start`; an installed app keeps it in the user's app data folder.
if (app.isPackaged) process.env.JARCHI_DATA_DIR ||= path.join(app.getPath('userData'), 'data');
const { HOST, PORT, DATA_DIR } = require('../core/config');
const ORIGIN = `http://${HOST}:${PORT}`;
const WINDOW_FILE = path.join(DATA_DIR, 'window.json');

let win, tray, quitting = false;

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
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
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

function open() {
  const { maximized, ...bounds } = savedBounds();
  win = new BrowserWindow({
    ...bounds,
    title: 'Jarchi',
    icon: path.join(ROOT, 'assets/brand/icons', process.platform === 'win32' ? 'jarchi.ico' : 'jarchi-256.png'), // the logo, square: every size sharp
    autoHideMenuBar: true,
    show: false,
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // the panel names its tab; the window stays "Jarchi"
  win.once('ready-to-show', () => (maximized ? win.maximize() : win.show()));
  win.on('close', (e) => {
    saveBounds();
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (own(url)) return { action: 'allow' };
    outside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (own(url)) return;
    e.preventDefault();
    outside(url);
  });
  win.loadURL(`${ORIGIN}/`);

  tray = new Tray(path.join(ROOT, 'assets/brand/icons', process.platform === 'win32' ? 'jarchi.ico' : 'jarchi-32.png'));
  tray.setToolTip('Jarchi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Jarchi', click: show },
    { label: 'Copy OBS alerts link', click: () => clipboard.writeText(`${ORIGIN}/widgets/alerts`) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('double-click', show);
}

if (!app.requestSingleInstanceLock()) app.quit(); // one Jarchi at a time: the first one shows its window instead
else {
  app.on('second-instance', show);
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(() => {
    // In its own process, the server's work (chat, alerts, files, the widgets' requests) never holds up the window. It
    // says when it's listening. If it stops (e.g. `npm start` already has the port), so does the app, with the server's
    // last error lines in a message: there's no console here.
    const server = utilityProcess.fork(path.join(ROOT, 'server/index.js'), [], { serviceName: 'Jarchi server', stdio: ['ignore', 'inherit', 'pipe'] });
    let errors = '';
    server.stderr.on('data', (d) => {
      process.stderr.write(d);
      errors = (errors + d).slice(-1500);
    });
    server.once('message', open);
    server.on('exit', (code) => {
      if (quitting) return;
      dialog.showErrorBox('Jarchi', `Jarchi stopped (code ${code}).\n\n${errors}`.trim());
      app.quit();
    });
  });
}
