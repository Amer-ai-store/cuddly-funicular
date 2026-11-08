// JAWAFA ONE AI — Windows desktop shell.
// Loads the hosted app over HTTPS so Firebase Authentication sees an authorised domain and company
// data stays behind Firestore rules. No credentials or company data are stored by this wrapper.
const { app, BrowserWindow, shell, session } = require("electron");
const path = require("node:path");
const cfg = require("./config.cjs");

const START_URL = cfg.appUrl(process.env);
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 380, minHeight: 600,
    backgroundColor: "#05080a", title: "JAWAFA ONE AI", autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (cfg.isAuthPopup(url) || cfg.isAppOrigin(url, START_URL))
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, parent: win, webPreferences: { contextIsolation: true, sandbox: true } } };
    if (cfg.openExternally(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (cfg.isAppOrigin(url, START_URL) || cfg.isAuthPopup(url)) return;
    e.preventDefault(); if (cfg.openExternally(url)) shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { url: START_URL, reason: String(desc) } });
  });
  win.loadURL(START_URL);
}

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(cfg.cleanUserAgent(session.defaultSession.getUserAgent()));
  // The app needs no device permissions; deny camera/mic/geolocation/notifications requests.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
