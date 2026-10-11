// Organizaciones de Supabase que el panel puede operar: las de la configuración del servidor (PANEL_ORG_SLUGS) más las que
// se agregaron desde el panel (con firma). Todo lo que no esté en esta lista es invisible e intocable para el panel.
import type { Almacen } from './almacen.ts';
import type { Config } from './config.ts';

export type OrigenOrg = 'servidor' | 'panel';
export type Permitidas = () => Promise<string[]>;

export async function organizacionesConOrigen(config: Pick<Config, 'organizaciones'>, almacen: Almacen): Promise<{ slug: string; origen: OrigenOrg }[]> {
  const guardadas = (await almacen.rpc<string[] | null>('panel_org_listar', {})) ?? [];
  const lista: { slug: string; origen: OrigenOrg }[] = config.organizaciones.map(slug => ({ slug, origen: 'servidor' as const }));
  for (const slug of guardadas) if (!lista.some(x => x.slug === slug)) lista.push({ slug, origen: 'panel' });
  return lista;
}

export function crearPermitidas(config: Pick<Config, 'organizaciones'>, almacen: Almacen): Permitidas {
  return async () => (await organizacionesConOrigen(config, almacen)).map(x => x.slug);
}
