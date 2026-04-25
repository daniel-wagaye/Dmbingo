type TelegramIdCellProps = {
  telegramId: number | string | null | undefined;
  onClick: (id: number) => void;
};

const TelegramIdCell = ({ telegramId, onClick }: TelegramIdCellProps) => {
  if (telegramId == null) return <>-</>;

  const numericId = typeof telegramId === 'string' ? Number(telegramId) : telegramId;

  return (
    <button
      type="button"
      className="telegram-id-link"
      onClick={(e) => { e.stopPropagation(); onClick(numericId); }}
    >
      {telegramId}
    </button>
  );
};

export default TelegramIdCell;
