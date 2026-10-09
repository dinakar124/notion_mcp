import { z } from 'zod';

/** Only the provider fields the mapper reads. Everything else is ignored, never forwarded. */

const richTextSchema = z.object({ plain_text: z.string() });

export const pageSchema = z.object({
  object: z.literal('page'),
  id: z.string(),
  created_time: z.string(),
  last_edited_time: z.string(),
  archived: z.boolean().optional(),
  in_trash: z.boolean().optional(),
  url: z.string(),
  properties: z.record(
    z.string(),
    z.object({ type: z.string(), title: z.array(richTextSchema).optional() }),
  ),
});
export type NotionPage = z.infer<typeof pageSchema>;

const listEnvelope = {
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
};

export const searchResponseSchema = z.object({
  results: z.array(z.object({ object: z.string() }).loose()),
  ...listEnvelope,
});

export const blockSchema = z.object({
  id: z.string(),
  type: z.string(),
  has_children: z.boolean(),
}).loose();
export type NotionBlock = z.infer<typeof blockSchema>;

export const blockChildrenSchema = z.object({
  results: z.array(blockSchema),
  ...listEnvelope,
});

export const blockTextSchema = z.object({ rich_text: z.array(richTextSchema) });
