import { useRef, useCallback } from 'react';
import { PlayerPick } from '../../hooks/useGameRoom';

interface TileGridProps {
  picks: Map<string, PlayerPick>;
  myTelegramId: number | null;
  pendingBoardId: number | null;
  onTileClick: (boardId: number) => void;
}

export default function TileGrid({
  picks,
  myTelegramId,
  pendingBoardId,
  onTileClick,
}: TileGridProps) {
  const getTileState = useCallback(
    (boardId: number): 'gray' | 'orange' | 'green' | 'pending' => {
      if (pendingBoardId === boardId) return 'pending';
      const pick = picks.get(boardId.toString());
      if (!pick || !pick.telegramId) return 'gray';
      if (Number(pick.telegramId) === Number(myTelegramId)) return 'green';
      return 'orange';
    },
    [myTelegramId, pendingBoardId, picks]
  );

  const handleClick = useCallback(
    (boardId: number) => {
      const state = getTileState(boardId);
      if (state === 'orange' || state === 'pending') return;
      onTileClick(boardId);
    },
    [getTileState, onTileClick]
  );

  return (
    <div className="tile-grid">
      {Array.from({ length: 500 }, (_, i) => {
        const boardId = i + 1;
        const state = getTileState(boardId);
        return (
          <button
            key={boardId}
            className={`tile tile-${state}`}
            onClick={() => handleClick(boardId)}
            disabled={state === 'orange' || state === 'pending'}
          >
            {state === 'pending' ? (
              <span className="tile-spinner" />
            ) : (
              boardId
            )}
          </button>
        );
      })}
    </div>
  );
}