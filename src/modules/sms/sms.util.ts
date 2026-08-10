export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}

export function externalSlug(name: string, externalId: number): string {
  return `${slugify(name)}-${externalId}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function mapInChunks<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (const batch of chunk(items, size)) {
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

/** Best-effort extraction of a short OTP from an SMS body. */
export function extractSmsCode(fullSms: string): string | null {
  const patterns = [
    /\b(\d{4,8})\b/,
    /\b([A-Z0-9]{4,8})\b/i,
  ];
  for (const pattern of patterns) {
    const match = fullSms.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
