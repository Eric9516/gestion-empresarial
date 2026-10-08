import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { useToast } from '../../components/ToastProvider';
import { useAddFamilia, useAddSubfamilia, useFamiliasQuery, useSubfamiliasQuery } from '../familias/useFamilias';
import { useSaveItem, type Item, type ItemInput } from './useItems';
import NuevoCodigoModal from './NuevoCodigoModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onClose: () => void;
  item: Item | null;
}

const emptyInput: ItemInput = { familia_id: '', subfamilia_id: '', numero: '', descripcion: '', ubicacion: '', stock: null, stock_minimo: null, punto_pedido: null, detalles: '' };

// Campo numérico opcional: vacío se guarda como null (y después como 0).
const aNumeroONull = (v: string) => (v === '' ? null : Number(v));

export default function ItemForm({ open, onClose, item }: Props) {
  const toast = useToast();
  const { data: familias } = useFamiliasQuery();
  const { data: subfamilias } = useSubfamiliasQuery();
  const saveItem = useSaveItem();
  const addFamilia = useAddFamilia();
  const addSubfamilia = useAddSubfamilia();

  const [input, setInput] = useState<ItemInput>(emptyInput);
  const [saving, setSaving] = useState(false);
  const [nuevoCodigo, setNuevoCodigo] = useState<'familia' | 'subfamilia' | null>(null);

  useEffect(() => {
    if (!open) return;
    setInput(item
      ? {
        familia_id: item.familia_id, subfamilia_id: item.subfamilia_id, numero: item.numero,
        descripcion: item.descripcion, ubicacion: item.ubicacion ?? '', stock: item.stock,
        stock_minimo: item.stock_minimo, punto_pedido: item.punto_pedido, detalles: item.detalles ?? '',
      }
      : emptyInput);
  }, [open, item]);

  const familia = useMemo(() => familias?.find(f => f.id === input.familia_id) ?? null, [familias, input.familia_id]);
  const subfamiliasDeLaFamilia = useMemo(
    () => (subfamilias ?? []).filter(s => s.familia_id === input.familia_id),
    [subfamilias, input.familia_id]
  );
  const subfamilia = useMemo(() => subfamiliasDeLaFamilia.find(s => s.id === input.subfamilia_id) ?? null, [subfamiliasDeLaFamilia, input.subfamilia_id]);

  const codigoPreview = familia && subfamilia && input.numero
    ? `M${familia.codigo}${subfamilia.codigo}${input.numero.padStart(5, '0')}`
    : '';

  async function crearFamilia(codigo: string, nombre: string) {
    try {
      const nueva = await addFamilia.mutateAsync({ codigo, nombre });
      setInput(prev => ({ ...prev, familia_id: nueva.id, subfamilia_id: '' }));
      setNuevoCodigo(null);
      toast('Familia creada', 'success');
    } catch (e) { toast('Error al crear la familia: ' + (e instanceof Error ? e.message : ''), 'error'); }
  }

  function abrirNuevaSubfamilia() {
    if (!input.familia_id) { toast('Elegí primero una familia', 'error'); return; }
    setNuevoCodigo('subfamilia');
  }

  async function crearSubfamilia(codigo: string, nombre: string) {
    try {
      const nueva = await addSubfamilia.mutateAsync({ familia_id: input.familia_id, codigo, nombre });
      setInput(prev => ({ ...prev, subfamilia_id: nueva.id }));
      setNuevoCodigo(null);
      toast('Subfamilia creada', 'success');
    } catch (e) { toast('Error al crear la subfamilia: ' + (e instanceof Error ? e.message : ''), 'error'); }
  }

  async function handleSave() {
    if (!input.familia_id || !input.subfamilia_id || !input.numero.trim() || !input.descripcion.trim()) {
      toast('Familia, subfamilia, número y descripción son obligatorios', 'error');
      return;
    }
    if (!familia || !subfamilia) return;
    setSaving(true);
    try {
      await saveItem.mutateAsync({ id: item?.id ?? null, input, familia, subfamilia });
      toast(item ? 'Repuesto actualizado' : 'Repuesto agregado', 'success');
      onClose();
    } catch (e) {
      toast('Error al guardar: ' + (e instanceof Error ? e.message : ''), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      large
      title={item ? 'Editar Repuesto' : 'Nuevo Repuesto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="success" onClick={() => void handleSave()} disabled={saving}>Guardar</Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="item-form-1">Familia *</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Select id="item-form-1" style={{ flex: 1 }} value={input.familia_id} onChange={e => setInput(prev => ({ ...prev, familia_id: e.target.value, subfamilia_id: '' }))}>
              <option value="">Elegir...</option>
              {familias?.map(f => <option key={f.id} value={f.id}>{f.nombre} ({f.codigo})</option>)}
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNuevoCodigo('familia')} title="Crear nueva familia">＋</Button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="item-form-2">Subfamilia *</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Select id="item-form-2" style={{ flex: 1 }} value={input.subfamilia_id} onChange={e => setInput(prev => ({ ...prev, subfamilia_id: e.target.value }))}>
              <option value="">Elegir...</option>
              {subfamiliasDeLaFamilia.map(s => <option key={s.id} value={s.id}>{s.nombre} ({s.codigo})</option>)}
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={abrirNuevaSubfamilia} title="Crear nueva subfamilia">＋</Button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="item-form-3">Número *</label>
          <Input id="item-form-3" type="text" inputMode="numeric" placeholder="Ej: 23" value={input.numero} onChange={e => setInput(prev => ({ ...prev, numero: e.target.value }))} />
        </div>
        <div className="form-group">
          <label htmlFor="item-form-4">Código</label>
          <Input id="item-form-4" type="text" disabled placeholder="Se arma solo..." value={codigoPreview} />
        </div>
        <div className="form-group full">
          <label htmlFor="item-form-5">Descripción *</label>
          <Textarea id="item-form-5" rows={2} value={input.descripcion} onChange={e => setInput(prev => ({ ...prev, descripcion: e.target.value }))} />
        </div>
        <div className="form-group">
          <label htmlFor="item-form-6">Ubicación</label>
          <Input id="item-form-6" type="text" placeholder="Ej: Estante 3B" value={input.ubicacion} onChange={e => setInput(prev => ({ ...prev, ubicacion: e.target.value }))} />
        </div>
        <div className="form-group">
          <label htmlFor="item-form-7">Stock</label>
          <Input id="item-form-7" type="number" min={0} placeholder="0" value={input.stock ?? ''} onChange={e => setInput(prev => ({ ...prev, stock: aNumeroONull(e.target.value) }))} />
        </div>
        <div className="form-group">
          <label htmlFor="item-form-8">Stock mínimo (cantidad que quiero tener)</label>
          <Input id="item-form-8" type="number" min={0} placeholder="0 = sin reposición" value={input.stock_minimo ?? ''} onChange={e => setInput(prev => ({ ...prev, stock_minimo: aNumeroONull(e.target.value) }))} />
        </div>
        <div className="form-group">
          <label htmlFor="item-form-9">Punto de pedido (aviso para comprar)</label>
          <Input id="item-form-9" type="number" min={0} placeholder="0" value={input.punto_pedido ?? ''} onChange={e => setInput(prev => ({ ...prev, punto_pedido: aNumeroONull(e.target.value) }))} />
        </div>
        <div className="form-group full">
          <label htmlFor="item-form-10">Detalles</label>
          <Textarea id="item-form-10" rows={2} placeholder="Información relevante que no es la descripción (ej: compatibilidad, repuesto alternativo)" value={input.detalles} onChange={e => setInput(prev => ({ ...prev, detalles: e.target.value }))} />
        </div>
      </div>
    </Modal>
    {nuevoCodigo === 'familia' && (
      <NuevoCodigoModal
        onClose={() => setNuevoCodigo(null)}
        titulo="Nueva familia"
        codigosExistentes={(familias ?? []).map(f => f.codigo)}
        mensajeDuplicado="Ya existe una familia con ese código"
        onGuardar={crearFamilia}
      />
    )}
    {nuevoCodigo === 'subfamilia' && (
      <NuevoCodigoModal
        onClose={() => setNuevoCodigo(null)}
        titulo={`Nueva subfamilia en ${familia?.nombre ?? ''}`}
        codigosExistentes={subfamiliasDeLaFamilia.map(s => s.codigo)}
        mensajeDuplicado={`Ya existe esa subfamilia dentro de "${familia?.nombre}"`}
        onGuardar={crearSubfamilia}
      />
    )}
    </>
  );
}
