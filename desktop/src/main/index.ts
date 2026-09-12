import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { DEFAULT_DAEMON_PORT, daemonHttpBase } from "../shared/daemon.js";

/** Repository root that owns the compiled desktop daemon CLI. The desktop app is a client of that
 *  daemon over HTTP/WebSocket only (connector-first — see ARCHITECTURE.md 5d), never importing its
 *  source directly, so VIRAL_ROOT is the one thing that ties the two projects together. */
const repoRoot = resolve(process.env.VIRAL_ROOT ?? join(__dirname, "..", "..", ".."));
const daemonPort = Number(process.env.VIRAL_DESKTOP_PORT ?? DEFAULT_DAEMON_PORT);

let daemon: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function startDaemon(): void {
  daemon = spawn(process.execPath, [join(repoRoot, "dist", "src", "cli.js"), "desktop-server", "--port", String(daemonPort)], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, VIRAL_ROOT: repoRoot }
  });
  daemon.on("exit", (code) => {
    if (!quitting) console.error(`Viral desktop daemon exited unexpectedly (code ${code}).`);
  });
}

async function waitForDaemon(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${daemonHttpBase(daemonPort)}/api/health`);
      if (response.ok) return;
    } catch { /* daemon still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Viral desktop daemon did not become healthy within ${timeoutMs}ms`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    resizable: true,
    backgroundColor: "#0b0f1a",
    title: "Viral Desktop",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    if (quitting || !mainWindow) return;
    event.preventDefault();
    mainWindow.hide();
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) void mainWindow.loadURL(devServerUrl);
  else void mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

function toggleWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, "..", "..", "resources", "tray-icon.png"));
  tray = new Tray(icon);
  tray.setToolTip("Viral Desktop");
  tray.on("click", toggleWindow);
  tray.on("right-click", () => {
    tray?.popUpContextMenu(Menu.buildFromTemplate([
      { label: "Show Viral Desktop", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: "Hide Viral Desktop", click: () => mainWindow?.hide() },
      { type: "separator" },
      { label: "Quit", click: () => { quitting = true; app.quit(); } }
    ]));
  });
}

function configureAutoStart(): void {
  // Only register the packaged app for Windows auto-start; a dev run should never mutate the owner's
  // real login items with the raw Electron binary (PRINCIPLES.md — avoid unnecessary side effects).
  if (process.platform === "win32" && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }
}

app.whenReady().then(async () => {
  startDaemon();
  await waitForDaemon();
  createWindow();
  createTray();
  configureAutoStart();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  console.error((error as Error).message);
  app.quit();
});

app.on("window-all-closed", () => {
  // The app lives in the tray; only the tray "Quit" item or app.quit() should end the process.
});

app.on("before-quit", () => {
  quitting = true;
  daemon?.kill();
});
