export const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const formatDateTime = (value: Date | null | undefined): string => {
  if (!value) {
    return '-';
  }
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString().slice(0, 16);
  return iso.replace('T', ' ');
};
