import { describe, expect, it } from 'vitest';
import { migracionesDe } from '../src/server/componentes.ts';
import { FUNCIONES } from '../src/server/generado.ts';
import { crearMundo } from './ayudas/mundo.ts';

describe('flujo completo (camino feliz)', () => {
  it('alta de llaves, ingreso, crear cliente, módulos, actualizar y auditoría', async () => {
    const m = await crearMundo();
    const n = m.navegador();
    const celular = m.nuevaLlave();
    const respaldo = m.nuevaLlave();

    // Estado inicial: sin llaves, el alta está abierta.
    let e = await n.get('/api/estado');
    expect(e.estado).toBe(200);
    expect(e.cuerpo).toMatchObject({ altaAbierta: true, hayLlaves: false, sesion: false });

    // Se registran dos llaves (celular + respaldo) dentro de la ventana de alta.
    expect((await n.registrar(celular, 'Celular')).cuerpo).toMatchObject({ ok: true, llaves: 1 });
    expect((await n.registrar(respaldo, 'Respaldo')).cuerpo).toMatchObject({ ok: true, llaves: 2 });

    // Ingreso: la cookie sale con todas las protecciones.
    const ingreso = await n.ingresar(celular);
    expect(ingreso.estado).toBe(200);
    const cookie = ingreso.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{40,}; Path=\/; Secure; HttpOnly; SameSite=Strict/);
    e = await n.get('/api/estado');
    expect(e.cuerpo.sesion).toBe(true);

    // Sin clientes al principio.
    expect((await n.get('/api/clientes')).cuerpo.clientes).toEqual([]);

    // Crear un cliente: plan -> firma -> pasos.
    const r = await n.hacer('crear', { nombre: 'Panadería Sol', correo: 'Dueno@Sol.com', modulos: ['deposito', 'tareas'], urlApp: 'https://sol.netlify.app' }, celular);
    expect(r.plan.estado).toBe(201);
    expect(r.plan.cuerpo.resumen.lineas.join('\n')).toContain('dueno@sol.com');
    expect(r.firma.estado).toBe(200);
    const ultimo = r.pasos.at(-1)!;
    expect(ultimo.cuerpo).toMatchObject({ estado: 'terminado' });
    expect(r.pasos.every(p => p.cuerpo.resultado !== 'fallo')).toBe(true);

    // Lo que quedó del otro lado.
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'panaderia-sol')!;
    expect(p).toBeDefined();
    // Contrató Depósito y Tareas: se instalan solo la Base y Abastecimiento (nada de Mantenimiento).
    expect(p.registro).toEqual(new Set(migracionesDe(['base', 'abastecimiento']).map(x => x.nombre)));
    expect([...p.funciones.keys()].sort()).toEqual(FUNCIONES.map(f => f.slug).sort());
    expect(p.secretos.get('PROJECT_SECRET_KEY')).toBe(p.claves.servicio);
    expect(p.auth).toMatchObject({ disable_signup: true, site_url: 'https://sol.netlify.app' });
    expect(p.dueno).toBe('dueno@sol.com');
    expect(p.empresa).toBe('Panadería Sol');
    expect(p.licencia).toMatchObject({ deposito: true, tareas: true, proveedores: false, comisionistas: false, envios: false });
    expect(m.falso.sqlInesperado).toEqual([]);

    // La contraseña inicial: se ve una vez, y después del acuse ya no.
    const planId = r.plan.cuerpo.id as string;
    const clave = await n.post(`/api/planes/${planId}/clave`);
    expect(clave.estado).toBe(200);
    expect(clave.cuerpo.correo).toBe('dueno@sol.com');
    expect(clave.cuerpo.clave).toBe(p.usuarios.get('dueno@sol.com'));
    expect((await n.post(`/api/planes/${planId}/acuse`)).estado).toBe(200);
    expect((await n.post(`/api/planes/${planId}/clave`)).estado).toBe(404);

    // Detalle del cliente.
    const det = await n.get(`/api/clientes/${p.ref}`);
    expect(det.cuerpo.detalle).toMatchObject({ instalado: true, registroPublico: 'cerrado', migraciones: { pendientes: [] } });
    expect(det.cuerpo.detalle.modulos).toMatchObject({ deposito: true, proveedores: false });

    // Cambiar módulos: activar proveedores y envíos; apagar tareas.
    const mod = await n.hacer('modulos', { ref: p.ref, activar: ['proveedores', 'envios'], desactivar: ['tareas'] }, celular);
    expect(mod.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect(p.licencia).toMatchObject({ proveedores: true, envios: true, tareas: false, deposito: true });

    // Actualizar: no hay nada pendiente, solo se vuelven a publicar las funciones.
    const act = await n.hacer('actualizar', { ref: p.ref }, celular);
    expect(act.plan.cuerpo.resumen.lineas.join(' ')).toContain('al día');
    expect(act.pasos.at(-1)!.cuerpo.estado).toBe('terminado');

    // La auditoría quedó encadenada y completa.
    const aud = await n.get('/api/auditoria');
    expect(aud.cuerpo.cadena).toMatchObject({ ok: true });
    const eventos = (aud.cuerpo.eventos as { evento: string }[]).map(x => x.evento);
    // La pantalla muestra solo los 60 más recientes y cada migración suma un "paso": con más migraciones, las altas de llaves del principio salen de esa ventana
    // (la cadena completa se verificó arriba), así que acá se miran los eventos del último tramo.
    expect(eventos).toEqual(expect.arrayContaining(['plan_creado', 'plan_autorizado', 'plan_terminado', 'clave_mostrada']));
    // Y se mandaron avisos al celular.
    expect(m.alertas.length).toBeGreaterThan(3);
  });
});
