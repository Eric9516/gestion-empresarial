import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { fetchUsuariosPorIds, nombreUsuario } from '../../lib/usuarios';
import type { ClaseMovimiento, TipoAjuste } from '../../lib/ajustes';

export interface AjusteLinea {
  id: string;
  tipo: TipoAjuste;
  cantidad: number;
  stock_antes: number | null;
  stock_despues: number | null;
  items: { codigo: string; descripcion: string; unidad: string } | null;
}

export interface Ajuste {
  id: string;
  created_at: string;
  usuario_id: string;
  clase: ClaseMovimiento;
  fecha: string;
  punto_venta: number;
  numero: number;
  referencia: string | null;
  observaciones: string | null;
  motivo: string;
  anulado: boolean;
  anulado_por: string | null;
  anulado_at: string | null;
  motivo_anulacion: string | null;
  ajuste_items: AjusteLinea[];
  usuarioNombre: string;
  anuladoPorNombre: string | null;
}

const PAGE_SIZE = 1000;
const CLAVE = ['ajustes'] as const;

// Todos los ajustes con sus líneas. Solo los puede leer quien puede ajustar (la base lo impone).
export function useAjustesQuery() {
  return useQuery({
    queryKey: CLAVE,
    queryFn: async (): Promise<Ajuste[]> => {
      const todos: Omit<Ajuste, 'usuarioNombre' | 'anuladoPorNombre'>[] = [];
      for (let desde = 0; ; desde += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('ajustes_inventario')
          .select('*, ajuste_items(id, tipo, cantidad, stock_antes, stock_despues, items(codigo, descripcion, unidad))')
          .order('created_at', { ascending: false })
          .range(desde, desde + PAGE_SIZE - 1);
        if (error) throw error;
        todos.push(...(data as unknown as typeof todos));
        if (!data || data.length < PAGE_SIZE) break;
      }
      const usuarios = await fetchUsuariosPorIds(todos.flatMap(a => [a.usuario_id, a.anulado_por].filter((x): x is string => !!x)));
      return todos.map(a => ({
        ...a,
        usuarioNombre: nombreUsuario(usuarios[a.usuario_id], a.usuario_id),
        anuladoPorNombre: a.anulado_por ? nombreUsuario(usuarios[a.anulado_por], a.anulado_por) : null,
      }));
    },
  });
}

// Después de ajustar o anular cambia el stock de los repuestos y su historial: se vuelve a leer todo eso.
function useRefrescarTodo() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE });
    void queryClient.invalidateQueries({ queryKey: ['items'] });
    void queryClient.invalidateQueries({ queryKey: ['historial-por-item'] });
  };
}

// Una carga de stock o un ajuste: un documento con su número, todo o nada. Devuelve el comprobante (por ejemplo "CAR 0001-00000012").
export function useCrearMovimiento() {
  const refrescar = useRefrescarTodo();
  return useMutation({
    mutationFn: async (m: { clase: ClaseMovimiento; fecha: string; motivo: string; referencia: string; observaciones: string; lineas: { item_id: string; tipo: TipoAjuste; cantidad: number }[] }) => {
      const { data, error } = await supabase.rpc('crear_movimiento_stock', { p_clase: m.clase, p_fecha: m.fecha, p_motivo: m.motivo, p_referencia: m.referencia, p_observaciones: m.observaciones, p_lineas: m.lineas });
      if (error) throw error;
      return data as { id: string; comprobante: string };
    },
    onSuccess: refrescar,
  });
}

export function useAnularAjuste() {
  const refrescar = useRefrescarTodo();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await supabase.rpc('anular_ajuste_inventario', { p_ajuste_id: id, p_motivo: motivo });
      if (error) throw error;
    },
    onSuccess: refrescar,
  });
}
