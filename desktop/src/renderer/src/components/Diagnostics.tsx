import { useState } from "react";
import type { DiagnosticsSnapshot } from "../types";

export function Diagnostics({ diagnostics }: { diagnostics: DiagnosticsSnapshot | null }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-8 shrink-0 border-l border-slate-800 bg-slate-950/60 text-xs text-slate-400 hover:text-cyan-400"
        title="Expand diagnostics"
      >
        ◀
      </button>
    );
  }

  const overallPercent = diagnostics?.taskProgress.length
    ? Math.round(diagnostics.taskProgress.reduce((sum, task) => sum + task.progressPercent, 0) / diagnostics.taskProgress.length)
    : 0;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-950/60">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Diagnostics</h2>
        <button onClick={() => setCollapsed(true)} className="text-xs text-slate-400 hover:text-purple-400" title="Collapse">▶</button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-xs">
        <section>
          <h3 className="mb-1 font-semibold text-slate-300">Progress</h3>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500" style={{ width: `${overallPercent}%` }} />
          </div>
          <p className="mt-1 text-slate-500">{overallPercent}% average across {diagnostics?.taskProgress.length ?? 0} task(s)</p>
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-slate-300">Token Usage</h3>
          {diagnostics?.tokenUsage.contextCharacters != null ? (
            <p className="text-slate-400">
              {diagnostics.tokenUsage.contextCharacters.toLocaleString()} / {diagnostics.tokenUsage.contextBudgetCharacters?.toLocaleString() ?? "?"} context chars
            </p>
          ) : (
            <p className="text-slate-500">No usage recorded yet.</p>
          )}
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-slate-300">System Health</h3>
          <ul className="space-y-1">
            {(diagnostics?.systemHealth.checks ?? []).map((check) => (
              <li key={check.name} className="flex items-start gap-2">
                <span className={check.passed ? "text-cyan-400" : "text-rose-400"}>{check.passed ? "●" : "●"}</span>
                <span className="text-slate-400">{check.name}: {check.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-slate-300">Recent Logs</h3>
          <ul className="space-y-1 font-mono text-[10px] text-slate-500">
            {(diagnostics?.recentLogs ?? []).slice(-10).reverse().map((log, index) => (
              <li key={index}>{log.timestamp} {log.status} {log.taskId}</li>
            ))}
            {(diagnostics?.recentLogs.length ?? 0) === 0 && <li>No recent activity.</li>}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-rose-400">Errors</h3>
          <ul className="space-y-1 text-rose-300/90">
            {(diagnostics?.errors ?? []).map((error, index) => <li key={index}>{error}</li>)}
            {(diagnostics?.errors.length ?? 0) === 0 && <li className="text-slate-500">None.</li>}
          </ul>
        </section>
      </div>
    </aside>
  );
}
