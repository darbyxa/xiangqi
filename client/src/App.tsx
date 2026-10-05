import { GameScreen } from './components/GameScreen';
import { Lobby } from './components/Lobby';
import { Toasts } from './components/Toasts';
import { useGameSession } from './hooks/useGameSession';

export default function App() {
  const s = useGameSession();

  let screen;
  if (s.view) {
    screen = (
      <GameScreen
        view={s.view}
        receivedAt={s.receivedAt}
        connection={s.connection}
        onMove={s.move}
        onResign={() => void s.resign()}
        onRestart={() => void s.requestRestart()}
        onRespond={(accept) => void s.respondRestart(accept)}
        onLeave={() => void s.leaveRoom()}
        notify={(text) => void s.notify(text)}
      />
    );
  } else if (s.restoring) {
    screen = (
      <div className="splash" role="status">
        <span className="splash-glyph" aria-hidden="true">象棋</span>
        <p>Returning to your game…</p>
      </div>
    );
  } else {
    screen = (
      <Lobby
        connection={s.connection}
        connectError={s.connectError}
        serverUrl={s.serverUrl}
        onCreate={s.createRoom}
        onJoin={s.joinRoom}
        resumable={s.resumable}
        onResume={s.resumeGame}
        onDismissResume={s.dismissResumable}
      />
    );
  }

  return (
    <>
      {screen}
      <Toasts toasts={s.toasts} onDismiss={s.dismissToast} />
    </>
  );
}
