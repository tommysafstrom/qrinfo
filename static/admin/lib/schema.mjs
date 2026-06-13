import { z } from 'zod';

// Internal targets resolve to hosted/<customerId>/<target>.html, so they keep
// the slug shape. (Codes are now identified by the numeric customerId/qid pair,
// not by a slug.)
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,30}$/;

// A code is identified by the pair (customerId, qid): each customer owns its own
// qid number space. Both are positive integers and appear in the URL as
// /q/<customerId>/<qid> and in the badge/file name as <customerId>-<qid>.
const idInt = z.number().int().positive();

const CODE_FIELDS = {
  customerId: idInt,
  qid: idInt,
  label: z.string().min(1).max(120),
  type: z.enum(['external', 'internal']),
  target: z.string().min(1).max(2000),
  enabled: z.boolean(),
};

/** Stable string id for a code: "<customerId>-<qid>". */
export function codeId(code) {
  return `${code.customerId}-${code.qid}`;
}

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
        message: 'internal target must match the slug pattern (matches hosted/<customerId>/<slug>.html)',
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

// Identity (customerId + qid) is immutable once created, so a patch can't change it.
export const codePatchSchema = z.object(CODE_FIELDS).partial().omit({ customerId: true, qid: true });

export const codesJsonSchema = z.object({
  version: z.literal(1),
  codes: z.array(codeSchema).default([]),
}).superRefine((doc, ctx) => {
  const seen = new Set();
  for (const [i, c] of doc.codes.entries()) {
    const id = codeId(c);
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['codes', i, 'qid'],
        message: `duplicate code id "${id}" (customerId ${c.customerId}, qid ${c.qid})`,
      });
    }
    seen.add(id);
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
