import { useEffect, useRef } from 'react';
import type { MoveRecord } from '../../../shared/protocol';

export function MoveHistory({ history }: { history: MoveRecord[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  // Red always opens, so round n = plies (2n-1, 2n).
  const rounds: { n: number; red?: MoveRecord; black?: MoveRecord }[] = [];
  history.forEach((m) => {
    const n = Math.ceil(m.ply / 2);
    if (!rounds[n - 1]) rounds[n - 1] = { n };
    rounds[n - 1][m.color] = m;
  });

  const cell = (m: MoveRecord | undefined, latest: boolean) =>
    m ? (
      <span className={`mv ${m.color}${latest ? ' latest' : ''}`}>
        {m.notation}
        {m.check && (
          <sup className="chk" title="Check">
            +
          </sup>
        )}
      </span>
    ) : (
      <span className="mv" />
    );

  return (
    <div className="history" ref={box} tabIndex={0} aria-label="Move history">
      {rounds.length === 0 ? (
        <p className="history-empty">No moves yet — Red opens.</p>
      ) : (
        <ol>
          {rounds.map((r) => (
            <li key={r.n}>
              <span className="no">{r.n}</span>
              {cell(r.red, r.red?.ply === history.length)}
              {cell(r.black, r.black?.ply === history.length)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
