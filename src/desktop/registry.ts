import { createEfficiencyServices } from "../efficiency/registry.js";
import { runDoctor } from "../doctor.js";
import { DesktopChatSession } from "./chat.js";
import { projectDiagnostics } from "./diagnostics.js";
import { DesktopServer, type DesktopServerOptions } from "./server.js";
import { projectTaskQueue } from "./tasks.js";

/** Wires the desktop daemon against the real repository: governed objectives, doctor health checks,
 *  efficiency telemetry, and the persisted task queue. Used by `viral-dev desktop-server` and by the
 *  Electron main process; tests construct DesktopServer directly against fakes instead. */
export async function createDesktopServer(root: string, options: DesktopServerOptions = {}): Promise<DesktopServer> {
  const services = await createEfficiencyServices(root);
  const chat = new DesktopChatSession(services.objectives);
  return new DesktopServer({
    chat,
    tasks: () => projectTaskQueue(root),
    diagnostics: () => projectDiagnostics({ root, doctor: () => runDoctor(root), telemetry: services.telemetry })
  }, options);
}
