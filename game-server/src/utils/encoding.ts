export function encodeCursor(createdAt: string, id: string | number): string {
  return Buffer.from(JSON.stringify({ created_at: createdAt, id: String(id) })).toString('base64');
}

export function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    const json = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    if (json.created_at && json.id) return { created_at: json.created_at, id: String(json.id) };
    return null;
  } catch {
    return null;
  }
}