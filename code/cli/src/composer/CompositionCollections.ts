export const stablePush = <T>(items: T[], keySet: Set<string>, key: string, value: T): void => {
  if (!keySet.has(key)) {
    keySet.add(key);
    items.push(value);
  }
};

export const union = (values: readonly string[] = [], next: readonly string[] = []): readonly string[] | undefined => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...values, ...next]) stablePush(merged, seen, value, value);
  return merged.length > 0 ? merged : undefined;
};

export const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)];

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
