import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/ToastProvider';
import { useConfiguracionQuery, useSaveConfiguracion } from '../config/useConfiguracion';
import { NOMBRE_EMPRESA_POR_DEFECTO } from '../../lib/empresa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function EmpresaPane() {
  const { data: config } = useConfiguracionQuery();
  const saveConfig = useSaveConfiguracion();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [logoBase64, setLogoBase64] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setNombre(config.empresa_nombre ?? '');
    setDireccion(config.empresa_direccion ?? '');
    setTelefono(config.empresa_telefono ?? '');
    setEmail(config.empresa_email ?? '');
    setLogoBase64(config.logo_base64 ?? '');
  }, [config]);

  function abrirSelectorDeLogo() {
    fileInputRef.current?.click();
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogoBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveConfig.mutateAsync({
        empresa_nombre: nombre.trim() || NOMBRE_EMPRESA_POR_DEFECTO,
        empresa_direccion: direccion.trim(),
        empresa_telefono: telefono.trim(),
        empresa_email: email.trim(),
        logo_base64: logoBase64,
      });
      toast('Configuración guardada', 'success');
    } catch {
      toast('Error al guardar configuración', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-card" style={{ maxWidth: 560 }}>
      <div className="admin-card-header">🏢 Datos de la Empresa</div>
      <div className="admin-card-body">
        <div className="form-group">
          <label>Logo de la empresa</label>
          <div
            className="logo-upload-area"
            role="button"
            tabIndex={0}
            aria-label="Subir logo de la empresa"
            onClick={abrirSelectorDeLogo}
            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirSelectorDeLogo(); } }}
            style={{ cursor: 'pointer' }}
          >
            {logoBase64 ? (
              <img src={logoBase64} alt="Logo" style={{ maxHeight: 80 }} />
            ) : (
              <p>📁 Clic para subir logo (PNG, JPG)</p>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} />
        </div>
        <div className="form-group"><label htmlFor="empresa-pane-1">Nombre de la empresa</label><Input id="empresa-pane-1" value={nombre} onChange={e => setNombre(e.target.value)} placeholder={NOMBRE_EMPRESA_POR_DEFECTO} /></div>
        <div className="form-group"><label htmlFor="empresa-pane-2">Dirección</label><Input id="empresa-pane-2" value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Av. Principal 1234" /></div>
        <div className="form-group"><label htmlFor="empresa-pane-3">Teléfono</label><Input id="empresa-pane-3" type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="(0000) 000-0000" /></div>
        <div className="form-group"><label htmlFor="empresa-pane-4">Email</label><Input id="empresa-pane-4" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contacto@empresa.com" /></div>
        <Button variant="primary" size="sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void handleSave()} disabled={saving}>Guardar configuración</Button>
      </div>
    </div>
  );
}
