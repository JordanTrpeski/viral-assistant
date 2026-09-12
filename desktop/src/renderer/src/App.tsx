import { Chat } from "./components/Chat";
import { Diagnostics } from "./components/Diagnostics";
import { TaskQueue } from "./components/TaskQueue";
import { useDaemon } from "./hooks/useDaemon";

export default function App(): JSX.Element {
  const { connected, chat, tasks, diagnostics, sendObjective, sendAnswer, error } = useDaemon();

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      {!connected && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1 text-center text-xs text-amber-300">
          Connecting to the Viral daemon…
        </div>
      )}
      {error && (
        <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-1 text-center text-xs text-rose-300">{error}</div>
      )}
      <div className="flex min-h-0 flex-1">
        <TaskQueue tasks={tasks} />
        <Chat chat={chat} onSendObjective={sendObjective} onSendAnswer={sendAnswer} />
        <Diagnostics diagnostics={diagnostics} />
      </div>
    </div>
  );
}
