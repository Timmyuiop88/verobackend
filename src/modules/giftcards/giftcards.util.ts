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

/**
 * Slugs are unique in the DB, and Reloadly happily ships several products
 * with the same name (different countries, same brand), so the external id
 * is always appended rather than only on collision.
 */
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
