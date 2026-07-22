import StatusBar from './StatusBar';
import ChatStream from './ChatStream';
import TaskPanel from './TaskPanel';

export default function Layout() {
  return (
    <div className="app">
      <StatusBar />
      <div className="body">
        <ChatStream />
        <TaskPanel />
      </div>
    </div>
  );
}
