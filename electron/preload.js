// The panel's one door into the desktop app (window.jarchiApp), for updates only: main.js sends their state on every
// page load and on every change; the panel shows it and asks for the restart. The last state is kept here, so the panel
// gets it whenever it starts listening.
const { contextBridge, ipcRenderer } = require('electron');

let state, listener;
ipcRenderer.on('update', (e, s) => {
  state = s;
  listener?.(s);
});
contextBridge.exposeInMainWorld('jarchiApp', {
  onUpdate(cb) {
    listener = cb;
    if (state) cb(state);
  },
  restart: () => ipcRenderer.send('update:restart'),
  seen: () => ipcRenderer.send('update:seen'),
});
