import { contextBridge } from "electron";
import { DEFAULT_DAEMON_PORT, daemonHttpBase, daemonWsBase } from "../shared/daemon.js";

const port = Number(process.env.VIRAL_DESKTOP_PORT ?? DEFAULT_DAEMON_PORT);

/** The renderer only ever needs the daemon's loopback base URLs — everything else flows over the
 *  HTTP/WebSocket connector, not Electron IPC (ARCHITECTURE.md 5d, connector-first boundary). */
contextBridge.exposeInMainWorld("viralDaemon", {
  httpBase: daemonHttpBase(port),
  wsBase: daemonWsBase(port)
});
