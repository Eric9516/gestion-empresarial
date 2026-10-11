// Lector de SQL: parte un archivo en sentencias respetando textos entre comillas, comentarios y cuerpos de funciones ($$ ... $$).
// Lo usan las herramientas que reparten las migraciones por componente.

export function partirSentencias(sql) {
  const sentencias = [];
  let inicio = 0, i = 0;
  const n = sql.length;
  const nuevaSentencia = (fin) => {
    const texto = sql.slice(inicio, fin).trim();
    if (texto) sentencias.push(texto);
    inicio = fin;
  };
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === '-' && d === '-') { while (i < n && sql[i] !== '\n') i++; continue; }          // comentario de línea
    if (c === '/' && d === '*') { const f = sql.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue; } // comentario de bloque
    if (c === "'") {                                                                          // texto entre comillas simples ('' escapa)
      i++;
      while (i < n) { if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } break; } i++; }
      i++; continue;
    }
    if (c === '"') { i++; while (i < n && sql[i] !== '"') i++; i++; continue; }              // identificador entre comillas dobles
    if (c === '$') {                                                                          // $$ ... $$  o  $etiqueta$ ... $etiqueta$
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i, i + 40));
      if (m) { const cierre = m[0]; const f = sql.indexOf(cierre, i + cierre.length); i = f < 0 ? n : f + cierre.length; continue; }
    }
    if (c === ';') { i++; nuevaSentencia(i); continue; }
    i++;
  }
  nuevaSentencia(n);
  return sentencias;
}

// Texto de la sentencia sin comentarios iniciales (para poder mirar con qué empieza).
export function sinComentariosIniciales(s) {
  let t = s;
  for (;;) {
    const antes = t;
    t = t.replace(/^\s*--[^\n]*\n?/, '').replace(/^\s*\/\*[\s\S]*?\*\//, '');
    if (t === antes) break;
  }
  return t.trim();
}

export const sinComillas = (x) => String(x).replace(/"/g, '');
