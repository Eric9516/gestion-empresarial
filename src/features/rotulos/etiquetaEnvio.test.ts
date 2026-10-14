import { describe, expect, it } from 'vitest';
import { descripcionDeEnvio, enviosDelProveedor, etiquetaDeEnvio } from './etiquetaEnvio';

const envio = { tipo_documento: null, numero_documento: '0001-00123', extra: null, comentario: null, created_at: '2026-10-12T15:00:00Z' };

describe('etiquetaDeEnvio', () => {
  it('muestra número, fecha y lo que lleva cada bulto', () => {
    const e = etiquetaDeEnvio(envio, ['Motor trifásico 5 HP', 'Bomba']);
    expect(e).toContain('0001-00123');
    expect(e).toContain('12/10/2026');
    expect(e).toContain('Motor trifásico 5 HP · Bomba');
  });

  it('con el tipo de documento lo antepone al número', () => {
    expect(etiquetaDeEnvio({ ...envio, tipo_documento: 'Remito' }, [])).toMatch(/^Remito 0001-00123 — /);
  });

  it('sin número lo dice, y sin descripción no deja guiones de más', () => {
    const e = etiquetaDeEnvio({ ...envio, numero_documento: null }, []);
    expect(e.startsWith('(sin número) — ')).toBe(true);
    expect(e.endsWith(' — ')).toBe(false);
  });

  it('si los bultos no tienen detalle, usa la nota del rótulo y después el comentario', () => {
    expect(descripcionDeEnvio({ extra: 'URGENTE', comentario: 'x' }, [])).toBe('URGENTE');
    expect(descripcionDeEnvio({ extra: null, comentario: 'Llamar antes' }, ['  ', ''])).toBe('Llamar antes');
    expect(descripcionDeEnvio({ extra: null, comentario: null }, [])).toBe('');
  });

  it('no repite el mismo detalle de varios bultos', () => {
    expect(descripcionDeEnvio({ extra: null, comentario: null }, ['Rodamiento', 'Rodamiento', 'Retén'])).toBe('Rodamiento · Retén');
  });

  it('recorta las descripciones muy largas', () => {
    const largo = descripcionDeEnvio({ extra: null, comentario: null }, ['a'.repeat(200)]);
    expect(largo.length).toBeLessThanOrEqual(70);
    expect(largo.endsWith('…')).toBe(true);
  });
});

describe('enviosDelProveedor', () => {
  const envios = [
    { id: 'e1', proveedor_id: 'p1' },
    { id: 'e2', proveedor_id: 'p2' },
    { id: 'e3', proveedor_id: 'p1' },
  ];

  it('deja solo los del proveedor elegido', () => {
    expect(enviosDelProveedor(envios, 'p1').map(e => e.id)).toEqual(['e1', 'e3']);
  });

  it('sin proveedor elegido no muestra ninguno', () => {
    expect(enviosDelProveedor(envios, '')).toEqual([]);
  });

  it('conserva el envío ya cargado aunque sea de otro proveedor', () => {
    expect(enviosDelProveedor(envios, 'p1', 'e2').map(e => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('sin lista todavía devuelve vacío', () => {
    expect(enviosDelProveedor(undefined, 'p1')).toEqual([]);
  });
});
