import Modal from '../../components/Modal';
import { useHistorialPorItem } from '../retiros/useHistorialPorItem';

export default function HistorialStockModal({ item, onClose }: { item: { id: string; codigo: string } | null; onClose: () => void }) {
  const { data: historial, isLoading } = useHistorialPorItem(item?.id ?? null);

  return (
    <Modal open={!!item} onClose={onClose} title={`📋 Historial de retiros — ${item?.codigo ?? ''}`}>
      {isLoading && <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>}
      {!isLoading && !historial?.length && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Todavía no se retiró este repuesto.</p>
      )}
      {!!historial?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {historial.map(h => (
            <div key={h.id} style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}>
                <span>{h.usuarioNombre}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {new Date(h.created_at).toLocaleString('es-AR')}
                </span>
              </div>
              <div style={{ color: 'var(--text-mid)', marginTop: 3 }}>
                Cantidad: {h.cantidad}{h.sector ? ` · Sector: ${h.sector}` : ''}
              </div>
              {h.observacion && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{h.observacion}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
