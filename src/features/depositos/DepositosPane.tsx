import { useState } from 'react';
import { Icono } from '@/components/Icono';
import { Button } from '@/components/ui/button';
import { mensajeDeError } from '@/lib/errores';
import { useToast } from '../../components/ToastProvider';
import { COLOR_DEPOSITO_ORIGINAL } from '../../lib/marca';
import DepositoFormModal, { type ValoresDeposito } from './DepositoFormModal';
import { iconoDeDeposito } from './iconos';
import { useCrearDeposito, useDepositos, useEditarDeposito, useTopeDepositos, type Deposito } from './useDepositos';

// Configuración → Depósito → Depósitos (solo el dueño): los depósitos de la empresa, con su nombre, color e ícono.
export default function DepositosPane() {
  const { data, isLoading } = useDepositos();
  const { data: tope = 1 } = useTopeDepositos();
  const crear = useCrearDeposito();
  const editar = useEditarDeposito();
  const toast = useToast();
  // undefined = cerrado, null = uno nuevo, un depósito = editándolo
  const [abierto, setAbierto] = useState<Deposito | null | undefined>(undefined);

  const todos = data?.todos ?? [];
  const enUso = todos.filter(d => d.activo).length;
  const lleno = enUso >= tope;

  async function guardar(v: ValoresDeposito) {
    try {
      if (abierto) {
        await editar.mutateAsync({ id: abierto.id, nombre: v.nombre, color: v.color, icono: v.icono, activo: abierto.es_principal ? true : v.activo, prefijo: v.prefijo });
        toast('Depósito guardado', 'success');
      } else {
        await crear.mutateAsync({ nombre: v.nombre, prefijo: v.prefijo, color: v.color, icono: v.icono });
        toast('Depósito creado', 'success');
      }
      setAbierto(undefined);
    } catch (e) {
      toast(mensajeDeError(e), 'error');
    }
  }

  return (
    <div className="admin-card" style={{ maxWidth: 640 }}>
      <div className="admin-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span><Icono n="deposito" /> Depósitos</span>
        <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>{enUso} de {tope} en uso</span>
      </div>
      <div className="admin-card-body">
        {isLoading && <p style={{ color: 'var(--text-muted)' }}>Cargando…</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {todos.map(d => (
            <li
              key={d.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1.5px solid var(--border)', borderRadius: 10, opacity: d.activo ? 1 : 0.6 }}
            >
              <span
                aria-hidden
                style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 20, color: '#fff', background: d.color ?? COLOR_DEPOSITO_ORIGINAL }}
              >
                <Icono n={iconoDeDeposito(d.icono)} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.nombre}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Letra {d.prefijo}{d.es_principal ? ' · Principal' : ''}{d.activo ? '' : ' · Desactivado'}
                </span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(d)} aria-label={`Editar ${d.nombre}`}><Icono n="editar" /> Editar</Button>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" size="sm" disabled={lleno} onClick={() => setAbierto(null)}><Icono n="mas" /> Nuevo depósito</Button>
          {lleno && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              El plan permite hasta {tope} depósito{tope === 1 ? '' : 's'}. Para tener más, pedí ampliar el plan.
            </p>
          )}
        </div>
      </div>
      {abierto !== undefined && (
        <DepositoFormModal
          key={abierto?.id ?? 'nuevo'}
          deposito={abierto ?? undefined}
          guardando={crear.isPending || editar.isPending}
          onGuardar={v => void guardar(v)}
          onClose={() => setAbierto(undefined)}
        />
      )}
    </div>
  );
}
