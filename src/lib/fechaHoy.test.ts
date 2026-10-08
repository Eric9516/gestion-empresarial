import { describe, expect, it } from 'vitest';
import { fechaHoyISO, formatearFechaSola } from './fechaHoy';

describe('formatearFechaSola', () => {
  it('muestra el mismo día que se guardó, sin correrlo por la zona horaria', () => {
    expect(formatearFechaSola('2026-10-06')).toBe('6/10/2026');
    expect(formatearFechaSola('2026-01-01')).toBe('1/1/2026');
    expect(formatearFechaSola('2026-12-31')).toBe('31/12/2026');
  });
});

describe('fechaHoyISO', () => {
  it('devuelve el día local con formato yyyy-mm-dd', () => {
    const d = new Date();
    const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(fechaHoyISO()).toBe(esperado);
    expect(fechaHoyISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
