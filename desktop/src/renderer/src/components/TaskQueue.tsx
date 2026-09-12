import type { DesktopTaskSummary, TaskStatus } from "../types";

const statusStyles: Record<TaskStatus, string> = {
  pending: "bg-slate-700 text-slate-200",
  in_progress: "bg-cyan-500/20 text-cyan-300",
  blocked: "bg-amber-500/20 text-amber-300",
  complete: "bg-purple-500/20 text-purple-300"
};

export function TaskQueue({ tasks }: { tasks: DesktopTaskSummary[] }): JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950/60">
      <header className="border-b border-slate-800 px-4 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Task Queue</h2>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {tasks.length === 0 && <p className="px-1 text-xs text-slate-500">No tasks yet.</p>}
        {tasks.map((task) => (
          <div key={task.id} className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-slate-200" title={task.id}>{task.id}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusStyles[task.status]}`}>
                {task.status}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{task.objective}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500"
                style={{ width: `${task.progressPercent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
