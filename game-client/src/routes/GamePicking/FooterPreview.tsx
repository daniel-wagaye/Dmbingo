import BINGO_CARDS from '../../data/bingoCards.json';

const HEADERS = ['B', 'I', 'N', 'G', 'O'];
const HEADER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7'];

interface FooterPreviewProps {
  boardId: number;
}

export default function FooterPreview({ boardId }: FooterPreviewProps) {
  const card = (BINGO_CARDS as Record<string, number[][]>)[String(boardId)];
  if (!card) return null;

  return (
    <div className="footer-preview">
      <div className="bingo-card-mini">
        <div className="bingo-headers">
          {HEADERS.map((h, i) => (
            <span key={h} className="bingo-header" style={{ color: HEADER_COLORS[i] }}>
              {h}
            </span>
          ))}
        </div>
        {card.map((row, ri) => (
          <div key={ri} className="bingo-row">
            {row.map((cell, ci) => {
              const isFree = ri === 2 && ci === 2;
              return (
                <span
                  key={ci}
                  className={`bingo-cell${isFree ? ' bingo-free' : ''}`}
                >
                  {isFree ? 'FREE' : cell}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <span className="board-label">Board #{boardId}</span>
    </div>
  );
}