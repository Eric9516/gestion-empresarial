import { describe, expect, it } from 'vitest';
import { prepararBusqueda, puntajeConBusquedaPreparada } from './useItems';

// No es una prueba de funcionamiento sino una medición: cuánto tarda la búsqueda con catálogos grandes. Falla solo si se vuelve MUY lenta
// (el tope es holgado a propósito, para no fallar en una computadora lenta), y deja los tiempos impresos para compararlos.
const PALABRAS = ['rodamiento', 'junta', 'tornillo', 'bomba', 'valvula', 'sensor', 'correa', 'filtro', 'motor', 'reten', 'acople', 'resorte', 'cable', 'fusible', 'rele'];

function catalogo(n: number) {
  const items = [];
  for (let i = 1; i <= n; i++) {
    const fam = String.fromCharCode(65 + (i % 20)) + String.fromCharCode(65 + (i % 7));
    items.push({
      codigo: `M${fam}${String(i % 100).padStart(2, '0')}${String(i).padStart(5, '0')}`,
      numero: String(i).padStart(5, '0'),
      descripcion: `${PALABRAS[i % PALABRAS.length]} ${PALABRAS[(i * 7) % PALABRAS.length]} tipo ${i % 97} medida ${i % 53}`,
      detalles: i % 5 === 0 ? `compatible con equipo ${i % 31} y repuesto alternativo ${i % 211}` : null,
    });
  }
  return items;
}

describe('velocidad de la búsqueda de repuestos', () => {
  for (const n of [5_000, 20_000, 50_000]) {
    it(`${n.toLocaleString('es-AR')} repuestos`, () => {
      const items = catalogo(n);
      const consultas = ['rodamiento', 'bomba 12', 'MAB00', 'valvula tipo 5 medida', 'zzzz'];
      const tiempos: number[] = [];
      for (const q of consultas) {
        const terminos = prepararBusqueda(q);
        const t0 = performance.now();
        const coinciden = items.map(it => ({ it, p: puntajeConBusquedaPreparada(it, terminos) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p);
        tiempos.push(performance.now() - t0);
        expect(coinciden.length).toBeGreaterThanOrEqual(0);
      }
      const peor = Math.max(...tiempos);
      console.log(`  ${n.toLocaleString('es-AR')} repuestos → por búsqueda: ${tiempos.map(t => t.toFixed(1) + ' ms').join(' · ')} (peor ${peor.toFixed(1)} ms)`);
      expect(peor).toBeLessThan(2000);
    });
  }
});
