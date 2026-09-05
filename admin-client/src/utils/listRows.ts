export const listRows = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
