import { z } from 'zod';

/** Data no formato AAAA-MM-DD que existe de verdade no calendário (recusa 2026-02-30, 2026-13-01…). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Data inválida.');
