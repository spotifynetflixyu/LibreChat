import { z } from 'zod';

export const steelDrawingEvidenceRowSchema = z
  .object({
    name: z.string().min(1),
    partNo: z.string().min(1),
    spec: z.string().min(1),
    quantity: z.number().int().positive(),
    boltSize: z.string().regex(/^M\d+$/),
    boltTotalExpression: z.string().min(1),
    boltTotal: z.number().int().nonnegative(),
    confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  })
  .superRefine((row, context) => {
    const match = row.boltTotalExpression
      .replace(/[xX＊*]/g, '×')
      .match(/^\s*(\d+)\s*×\s*(\d+)\s*=\s*(\d+)\s*$/);

    if (!match) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['boltTotalExpression'],
        message: 'boltTotalExpression must use a quantity x count = total expression',
      });
      return;
    }

    const left = Number(match[1]);
    const right = Number(match[2]);
    const total = Number(match[3]);

    if (left * right !== total || total !== row.boltTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['boltTotalExpression'],
        message: 'boltTotalExpression total must equal boltTotal',
      });
    }
  });

export const steelDrawingEvidenceResultSchema = z.object({
  fixtureId: z.string().optional(),
  sourceFile: z.string().min(1).optional(),
  rows: z.array(steelDrawingEvidenceRowSchema),
  warnings: z.array(z.string()).default([]),
});

export type SteelDrawingEvidenceRow = z.infer<typeof steelDrawingEvidenceRowSchema>;
export type SteelDrawingEvidenceResult = z.infer<typeof steelDrawingEvidenceResultSchema>;
