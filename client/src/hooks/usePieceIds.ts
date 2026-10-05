import { useState } from 'react';
import type { Board, RoomView } from '../../../shared/protocol';

let counter = 1;
const fresh = (board: Board): number[] => board.map((p) => (p ? counter++ : 0));

/**
 * The server sends plain boards, but to animate a piece sliding from A to B React needs a
 * stable identity for it. We derive identities client-side: when exactly one new move has
 * arrived, the piece id on the `from` square simply follows the move to the `to` square.
 * Anything else (new game, reconnect after missed moves) gets fresh ids — no animation.
 */
export function usePieceIds(view: RoomView): number[] {
  const [tracked, setTracked] = useState(() => ({
    code: view.code,
    len: view.history.length,
    ids: fresh(view.board),
  }));

  if (tracked.code === view.code && tracked.len === view.history.length) return tracked.ids;

  let ids: number[];
  if (tracked.code === view.code && view.history.length === tracked.len + 1 && view.lastMove) {
    ids = tracked.ids.slice();
    ids[view.lastMove.to] = ids[view.lastMove.from];
    ids[view.lastMove.from] = 0;
  } else {
    ids = fresh(view.board);
  }
  // Updating state while rendering is React's sanctioned way to derive state from changing props.
  setTracked({ code: view.code, len: view.history.length, ids });
  return ids;
}
