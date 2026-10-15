import { clicConTeclado } from '@/lib/clicConTeclado';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/ToastProvider';
import BotonSubir from '../../components/BotonSubir';
import ResponsiveList, { type Column } from '../../components/ResponsiveList';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useFamiliasQuery, useSubfamiliasQuery } from '../familias/useFamilias';
import { useRetiroCart } from '../retiros/RetiroCartContext';
import { prepararBusqueda, puntajeConBusquedaPreparada, useItemsQuery, type Item } from './useItems';
import ItemForm from './ItemForm';
import ItemDetail from './ItemDetail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Icono } from '@/components/Icono';

// Con miles de repuestos, una búsqueda amplia puede matchear cientos: dibujarlos todos juntos se vuelve pesado. Se muestran los más relevantes
// de a tandas (el botón "Ver más" suma otra) y se avisa el total. Cada tanda solo agrega filas: no vuelve a calcular la búsqueda.
const TANDA = 100;

// Botón "Retirar" de cada fila. Está afuera de la lista (no adentro) para que no se rehaga entero cada vez que cambia el carrito.
function RetirarBtn({ enCarrito, onRetirar }: { enCarrito: boolean; onRetirar: () => void }) {
  return (
    <Button variant="primary" size="sm" onClick={onRetirar}>
      {enCarrito ? <><Icono n="ok" /> Agregado</> : <><Icono n="retirar" /> Retirar</>}
    </Button>
  );
}

export default function ItemsList() {
  const { data: items, isLoading, isError } = useItemsQuery();
  const { data: familias } = useFamiliasQuery();
  const { data: subfamilias } = useSubfamiliasQuery();
  const { cart, addItem } = useRetiroCart();
  const toast = useToast();

  const [search, setSearch] = useState('');
  // El catálogo tiene miles de repuestos: recalcular el puntaje de búsqueda
  // en cada tecla se sentía trabado. El cuadro de texto se actualiza al
  // instante; el filtrado pesado espera a que la persona haga una pausa.
  const searchDebounced = useDebouncedValue(search, 250);
  const buscando = search.trim() !== searchDebounced.trim();
  const [familiaId, setFamiliaId] = useState('');
  const [subfamiliaId, setSubfamiliaId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  // Se guarda solo el id, no el objeto Item completo — así, si una mutación
  // (p.ej. cambiar la miniatura) invalida la lista y trae datos frescos, el
  // modal abierto los refleja solo sin tener que cerrarlo y volver a abrirlo.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId ? (items ?? []).find(it => it.id === viewingId) ?? null : null;
  const [mostrarStock, setMostrarStock] = useState(false);
  // Cuántos resultados se piden, y para qué búsqueda: si la búsqueda o un filtro cambian, la cuenta vuelve a la primera tanda (se ajusta al dibujar,
  // sin efectos, y también si más tarde se vuelve a la misma búsqueda).
  const claveDeBusqueda = `${searchDebounced}|${familiaId}|${subfamiliaId}`;
  const [pedido, setPedido] = useState({ clave: claveDeBusqueda, cantidad: TANDA });
  if (pedido.clave !== claveDeBusqueda) setPedido({ clave: claveDeBusqueda, cantidad: TANDA });
  const visibles = pedido.clave === claveDeBusqueda ? pedido.cantidad : TANDA;

  // El botón "Stock" es puntual a la tanda de resultados actual: si cambia la
  // búsqueda o los filtros (incluido borrarlos), la columna se oculta y hay
  // que volver a pedirla explícitamente.
  useEffect(() => { setMostrarStock(false); }, [search, familiaId, subfamiliaId]);

  // Ids de lo que ya está en el carrito, para saber de un vistazo si una fila dice "Retirar" o "Agregado".
  const idsEnCarrito = useMemo(() => new Set(cart.map(c => c.item_id)), [cart]);

  const subfamiliasDeLaFamilia = useMemo(
    () => (subfamilias ?? []).filter(s => !familiaId || s.familia_id === familiaId),
    [subfamilias, familiaId]
  );

  const sinFiltro = !search.trim() && !familiaId && !subfamiliaId;

  // Se interpreta la búsqueda (separar palabras, sacar conectoras, calcular
  // versión sin ceros) UNA sola vez acá, no una vez por cada uno de los
  // miles de repuestos — eso era lo que volvía pesado el filtrado.
  const busquedaPreparada = useMemo(() => prepararBusqueda(searchDebounced), [searchDebounced]);

  const coincidencias = useMemo(() => {
    if (sinFiltro) return [] as Item[];
    return (items ?? [])
      .map(it => ({ it, puntaje: puntajeConBusquedaPreparada(it, busquedaPreparada) }))
      .filter(({ it, puntaje }) => {
        const matchFamilia = !familiaId || it.familia_id === familiaId;
        const matchSub = !subfamiliaId || it.subfamilia_id === subfamiliaId;
        return puntaje > 0 && matchFamilia && matchSub;
      })
      .sort((a, b) => b.puntaje - a.puntaje)
      .map(({ it }) => it);
  }, [items, busquedaPreparada, familiaId, subfamiliaId, sinFiltro]);
  // Pedir otra tanda solo recorta la lista ya calculada: no vuelve a puntuar los miles de repuestos.
  const filtrados = useMemo(() => coincidencias.slice(0, visibles), [coincidencias, visibles]);
  const totalCoincidencias = coincidencias.length;
  const restantes = totalCoincidencias - filtrados.length;

  function handleRetirar(item: Item) {
    addItem(item);
    toast(`${item.codigo} agregado al carrito`, 'success');
  }

  // El estado "Agregado" se lee directo del carrito: se mantiene mientras el ítem siga ahí, y solo desaparece cuando se saca del carrito o se confirma
  // el retiro (que lo vacía).
  const botonRetirar = (item: Item) => <RetirarBtn enCarrito={idsEnCarrito.has(item.id)} onRetirar={() => handleRetirar(item)} />;

  const columns: Column<Item>[] = [
    {
      header: 'Código', render: it => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }} {...clicConTeclado(() => setViewingId(it.id))}>
          <strong>{it.codigo}</strong>
          {it.foto_url && <img src={it.foto_url} alt="" loading="lazy" decoding="async" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />}
        </div>
      ),
    },
    { header: 'Descripción', render: it => <span style={{ cursor: 'pointer' }} onClick={() => setViewingId(it.id)}>{it.descripcion}</span> },
    ...(mostrarStock ? [{ header: 'Stock', render: (it: Item) => <span>{it.stock ?? '-'}</span> } as Column<Item>] : []),
    { header: '', render: it => <div className="td-actions" style={{ flexWrap: 'nowrap' }}>{botonRetirar(it)}</div> },
  ];

  function renderCard(it: Item) {
    return (
      <div className="prov-card">
        <div className="prov-card-header" {...clicConTeclado(() => setViewingId(it.id))} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, width: '100%' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="prov-card-name">{it.codigo}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 2, lineHeight: '16px', minHeight: 32 }}>{it.descripcion}</div>
            </div>
            {it.foto_url && <img src={it.foto_url} alt="" loading="lazy" decoding="async" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
          </div>
          {mostrarStock && <span className="badge badge-rubro">Stock: {it.stock ?? '-'}</span>}
        </div>
        <div className="prov-card-actions">
          {botonRetirar(it)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <div className="section-title"><Icono n="buscar" /> Buscar repuestos</div>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <Input type="text" placeholder="Código, número o descripción..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select className="filter-select" value={familiaId} onChange={e => { setFamiliaId(e.target.value); setSubfamiliaId(''); }}>
          <option value="">Todas las familias</option>
          {familias?.map(f => <option key={f.id} value={f.id}>{f.nombre} ({f.codigo})</option>)}
        </Select>
        <Select className="filter-select" value={subfamiliaId} onChange={e => setSubfamiliaId(e.target.value)}>
          <option value="">Todas las subfamilias</option>
          {subfamiliasDeLaFamilia.map(s => <option key={s.id} value={s.id}>{s.nombre} ({s.codigo})</option>)}
        </Select>
        {!sinFiltro && (
          <Button variant="ghost" size="sm" onClick={() => setMostrarStock(v => !v)}>
            
            <Icono n="paquete" /> {mostrarStock ? 'Ocultar stock' : 'Stock'}
          </Button>
        )}
      </div>

      {isLoading && <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>}
      {isError && <p style={{ color: 'var(--danger)' }}>Error al cargar el catálogo.</p>}
      {!isLoading && !isError && buscando && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}><Icono n="buscar" /> Buscando...</p>}
      {!isLoading && !isError && !buscando && restantes > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Mostrando los {filtrados.length} más relevantes de {totalCoincidencias} — afiná la búsqueda para ver menos, o usá "Ver más" al final.
        </p>
      )}

      {!isLoading && !isError && sinFiltro && items?.length !== 0 && (
        <div className="empty-state">
          <div className="empty-icon"><Icono n="buscar" /></div>
          <h3>Buscá un repuesto</h3>
          <p>Escribí un código, número o descripción, o elegí una familia para ver resultados.</p>
        </div>
      )}

      {!isLoading && !isError && (!sinFiltro || items?.length === 0) && (
        <ResponsiveList
          columns={columns}
          data={filtrados}
          renderCard={renderCard}
          keyField={it => it.id}
          emptyIcon={<Icono n="herramienta" />}
          emptyTitle={items?.length === 0 ? 'Todavía no hay repuestos cargados' : 'Sin resultados'}
          emptyDescription={items?.length === 0 ? 'Cargá el primer repuesto del depósito.' : 'Probá con otro código, número o filtro.'}
        />
      )}

      {!isLoading && !isError && !buscando && restantes > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, margin: '16px 0 8px' }}>
          <Button variant="ghost" onClick={() => setPedido({ clave: claveDeBusqueda, cantidad: visibles + TANDA })}>
            <Icono n="abajo" /> Ver {Math.min(TANDA, restantes)} más
          </Button>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Mostrando {filtrados.length} de {totalCoincidencias} · quedan {restantes}</span>
        </div>
      )}
      <BotonSubir />

      <ItemForm open={formOpen} onClose={() => setFormOpen(false)} item={editing} />
      {viewing && (
        <ItemDetail
          item={viewing}
          onClose={() => setViewingId(null)}
          onEdit={() => { setEditing(viewing); setViewingId(null); setFormOpen(true); }}
        />
      )}
    </div>
  );
}
