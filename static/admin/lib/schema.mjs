import { z } from 'zod';

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,30}$/;

const CODE_FIELDS = {
  slug: z.string().regex(
    SLUG_REGEX,
    'slug must be lowercase letters/digits/hyphens, 3–31 chars, starting with a letter or digit',
  ),
  label: z.string().min(1).max(120),
  type: z.enum(['external', 'internal']),
  target: z.string().min(1).max(2000),
  enabled: z.boolean(),
};

function refineTarget(code, ctx) {
  if (code.type === 'external') {
    let parsed;
    try { parsed = new URL(code.target); }
    catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'external target must be a valid URL (include http:// or https://)',
      });
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: `external target protocol "${parsed.protocol}" not allowed; use http(s)`,
      });
    }
  } else if (code.type === 'internal') {
    if (!SLUG_REGEX.test(code.target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'internal target must match the slug pattern (matches info/<slug>.html)',
      });
    }
  }
}

export const codeSchema = z.object({
  ...CODE_FIELDS,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine(refineTarget);

export const codeInputSchema = z.object(CODE_FIELDS).superRefine(refineTarget);

export const codePatchSchema = z.object(CODE_FIELDS).partial().omit({ slug: true });

export const codesJsonSchema = z.object({
  version: z.literal(1),
  codes: z.array(codeSchema).default([]),
}).superRefine((doc, ctx) => {
  const seen = new Set();
  for (const [i, c] of doc.codes.entries()) {
    if (seen.has(c.slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['codes', i, 'slug'],
        message: `duplicate slug "${c.slug}"`,
      });
    }
    seen.add(c.slug);
  }
});

export const releaseEntrySchema = z.object({
  tag: z.string(),
  commit: z.string(),
  cfDeployId: z.string().nullable(),
  deployedAt: z.string().datetime(),
  url: z.string().url().optional(),
});

export const releaseStateSchema = z.object({
  version: z.literal(1),
  current: releaseEntrySchema.nullable(),
  previous: z.array(releaseEntrySchema).default([]),
});
