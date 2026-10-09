/** Media type of a Content-Type header value, without parameters, lower-cased. */
export function contentMediaType(value: string | null): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase();
}

/** Media types an Accept header allows (quality > 0). Wildcards are intentionally not expanded. */
export function acceptedMediaTypes(value: string | null): Set<string> {
  const accepted = new Set<string>();
  for (const range of value?.split(',') ?? []) {
    const [rawType, ...rawParams] = range.split(';');
    const type = rawType?.trim().toLowerCase();
    if (!type) continue;

    let quality = 1;
    for (const rawParam of rawParams) {
      const [name, rawValue] = rawParam.split('=', 2).map((part) => part.trim());
      if (name?.toLowerCase() === 'q') {
        const parsed = Number(rawValue);
        quality = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    if (quality > 0) accepted.add(type);
  }
  return accepted;
}
