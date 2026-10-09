import { z } from 'zod';
import { type PageId, tryParsePageId } from '../../domain/notion.ts';

/** Accepts a UUID with or without dashes and yields the canonical PageId. */
export const pageIdSchema = z.string().describe('Notion page id (UUID, dashes optional).')
  .transform(
    (raw, ctx): PageId => {
      const id = tryParsePageId(raw);
      if (id === null) {
        ctx.addIssue({ code: 'custom', message: 'Expected a 32-hex-digit page UUID.' });
        return z.NEVER;
      }
      return id;
    },
  );
