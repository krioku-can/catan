import { SocketProvider, useSocket } from './hooks/useSocket';
import Lobby from './components/Lobby';
import OnlineGame from './components/OnlineGame';

function AppContent() {
  const { gameState } = useSocket();

  if (gameState) {
    return <OnlineGame />;
  }

  return <Lobby />;
}

export default function App() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}
