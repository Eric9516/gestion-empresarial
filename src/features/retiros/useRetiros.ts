import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../auth/AuthContext';
import { puedeVerTodosLosRetiros } from '../../lib/types';
import { exportarExcel } from '../../lib/exportExcel';
import { nombreUsuario, type UsuarioBasico } from '../../lib/usuarios';
import type { RetiroCartLine } from './RetiroCartContext';
import { finDelDiaISO, inicioDelDiaISO } from '../../lib/fechaHoy';

export interface RetiroHistorialItem {
  id: string;
  cantidad: number;
  observacion: string | null;
  items: { codigo: string; descripcion: string } | null;
}

export interface RetiroHistorial {
  id: string;
  usuario_id: string;
  created_at: string;
  observacion_general: string | null;
  sectores: { nombre: string } | null;
  retiro_items: RetiroHistorialItem[];
}

async function fetchUsuariosPerfil() {
  const { data, error } = await supabase.from('usuarios_perfil').select('id, nombre, apellido, email');
  if (error) throw error;
  return data;
}

// El stock no puede quedar negativo (lo hace cumplir la base). Antes de confirmar se mira el stock de ahora de cada línea y se avisa de TODAS las que no alcanzan juntas,
// en vez de que la base rechace el retiro por la primera. (Si en el medio otra persona saca el último, la base igual lo rechaza: esto es solo para avisar mejor.)
export async function stockQueFalta(lineas: { item_id: string; codigo: string; cantidad: number }[]) {
  const { data, error } = await supabase.from('items').select('id, stock').in('id', lineas.map(l => l.item_id));
  if (error) throw error;
  const hay = new Map((data ?? []).map(r => [r.id, r.stock ?? 0]));
  return lineas.filter(l => l.cantidad > (hay.get(l.item_id) ?? 0)).map(l => ({ codigo: l.codigo, hay: hay.get(l.item_id) ?? 0, pide: l.cantidad }));
}

export function useConfirmarRetiro() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ sectorId, observacionGeneral, items }: { sectorId: string; observacionGeneral: string; items: RetiroCartLine[] }) => {
      if (!profile) throw new Error('Sesión no disponible');
      // Una sola operación en la base: el retiro y todas sus líneas, o nada (antes eran dos pedidos y si fallaba el segundo quedaba un retiro vacío).
      const { data, error } = await supabase.rpc('confirmar_retiro', {
        p_sector_id: sectorId,
        p_observacion: observacionGeneral,
        p_lineas: items.map(line => ({ item_id: line.item_id, cantidad: line.cantidad, observacion: line.observacion || '' })),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['historial-retiros'] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: ['historial-por-item'] });
    },
  });
}

export function useHistorialRetirosQuery(fechaFiltro: string, usuarioFiltro: string) {
  const { profile } = useAuth();
  const admin = puedeVerTodosLosRetiros(profile);

  const retirosQuery = useQuery({
    queryKey: ['historial-retiros', fechaFiltro, admin],
    queryFn: async () => {
      let query = supabase
        .from('retiros')
        .select('id, usuario_id, created_at, observacion_general, sectores(nombre), retiro_items(id, cantidad, observacion, items(codigo, descripcion))')
        .order('created_at', { ascending: false });

      if (fechaFiltro) {
        query = query.gte('created_at', inicioDelDiaISO(fechaFiltro)).lte('created_at', finDelDiaISO(fechaFiltro));
      } else {
        const desde = new Date();
        desde.setDate(desde.getDate() - 30);
        query = query.gte('created_at', desde.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as RetiroHistorial[];
    },
  });

  const usuariosQuery = useQuery({
    queryKey: ['usuarios-perfil-nombres'],
    enabled: admin,
    queryFn: fetchUsuariosPerfil,
  });

  const retiros = (retirosQuery.data ?? []).filter(r => !usuarioFiltro || r.usuario_id === usuarioFiltro);

  return { retiros, admin, usuarios: usuariosQuery.data ?? [], isLoading: retirosQuery.isLoading, isError: retirosQuery.isError };
}

export function useUpdateHistorialCantidad() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cantidad }: { id: string; cantidad: number }) => {
      const { error } = await supabase.from('retiro_items').update({ cantidad }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['historial-retiros'] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: ['historial-por-item'] });
    },
  });
}

// ===== EXPORTAR A EXCEL (admin) =====

interface RetiroParaExportar extends RetiroHistorial {
  exportado?: boolean;
}

function retirosAFilas(retiros: RetiroParaExportar[], usuarios: Record<string, UsuarioBasico>) {
  const filas: Record<string, string | number>[] = [];
  for (const r of retiros) {
    const usuarioNombre = nombreUsuario(usuarios[r.usuario_id], r.usuario_id);
    for (const ri of r.retiro_items) {
      filas.push({
        Fecha: new Date(r.created_at).toLocaleString('es-AR'),
        Usuario: usuarioNombre,
        Sector: r.sectores?.nombre || '',
        Código: ri.items?.codigo || '',
        Descripción: ri.items?.descripcion || '',
        Cantidad: ri.cantidad,
        Observación: ri.observacion || '',
        'Observación general': r.observacion_general || '',
      });
    }
  }
  return filas;
}

async function fetchUsuariosPorId() {
  const data = await fetchUsuariosPerfil();
  return Object.fromEntries(data.map(u => [u.id, u]));
}

// Marca cada retiro exportado como tal — la próxima vez que se pida "exportar
// pendientes" no vuelve a traer los que ya se descargaron una vez.
export function useExportarRetirosPendientes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: retiros, error } = await supabase
        .from('retiros')
        .select('id, usuario_id, created_at, observacion_general, sectores(nombre), retiro_items(id, cantidad, observacion, items(codigo, descripcion))')
        .eq('exportado', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (!retiros?.length) return 0;

      const usuarios = await fetchUsuariosPorId();
      await exportarExcel(retirosAFilas(retiros as unknown as RetiroParaExportar[], usuarios), 'Retiros', `retiros_pendientes_${new Date().toISOString().slice(0, 10)}.xlsx`);

      for (const r of retiros) {
        await supabase.from('retiros').update({ exportado: true }).eq('id', r.id);
      }
      return retiros.length;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['historial-retiros'] }); },
  });
}

export function useExportarRetirosPeriodo() {
  return useMutation({
    mutationFn: async ({ desde, hasta }: { desde: string; hasta: string }) => {
      const { data: retiros, error } = await supabase
        .from('retiros')
        .select('id, usuario_id, created_at, observacion_general, sectores(nombre), retiro_items(id, cantidad, observacion, items(codigo, descripcion))')
        .gte('created_at', inicioDelDiaISO(desde))
        .lte('created_at', finDelDiaISO(hasta))
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (!retiros?.length) return 0;

      const usuarios = await fetchUsuariosPorId();
      await exportarExcel(retirosAFilas(retiros as unknown as RetiroParaExportar[], usuarios), 'Retiros', `retiros_${desde}_a_${hasta}.xlsx`);
      return retiros.length;
    },
  });
}

export function useDeleteHistorialItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ retiroItemId, retiroId }: { retiroItemId: string; retiroId: string }) => {
      const { error } = await supabase.from('retiro_items').delete().eq('id', retiroItemId);
      if (error) throw error;
      const { data: restantes } = await supabase.from('retiro_items').select('id').eq('retiro_id', retiroId);
      if (restantes && restantes.length === 0) {
        await supabase.from('retiros').delete().eq('id', retiroId);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['historial-retiros'] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: ['historial-por-item'] });
    },
  });
}
