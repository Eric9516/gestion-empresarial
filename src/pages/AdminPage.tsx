import { useMemo, useState, type ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isDirectorioAdmin, isMantenimientoAdmin, isOwner, puedeResetearContrasenas, puedeVerErrores, puedeVerSugerencias, tieneAccesoAdmin, type Profile } from '../lib/types';
import UserMenu from '../components/UserMenu';
import MobileMenu from '../components/MobileMenu';
import { useConfiguracionQuery } from '../features/config/useConfiguracion';
import EmpresaPane from '../features/admin/EmpresaPane';
import RotuloDesignPane from '../features/admin/RotuloDesignPane';
import ComisionistasCamposPane from '../features/admin/ComisionistasCamposPane';
import RepuestosPane from '../features/admin/RepuestosPane';
import SectoresPanel from '../features/sectores/SectoresPanel';
import FamiliasPane from '../features/admin/FamiliasPane';
import UsuariosPane from '../features/admin/UsuariosPane';
import HistorialPane from '../features/admin/HistorialPane';
import ErroresPane from '../features/admin/ErroresPane';
import PapeleraPane from '../features/admin/PapeleraPane';
import FotosPendientesPane from '../features/admin/FotosPendientesPane';
import SugerenciasPane from '../features/admin/SugerenciasPane';

type Grupo = 'directorio' | 'mantenimiento' | 'general';

interface AdminTab {
  id: string;
  group: Grupo;
  label: string;
  check: (profile: Profile | null) => boolean;
  Pane: () => ReactElement;
}

// Espeja ADMIN_TABS de main.js: una sola pantalla de Configuración con pestañas
// agrupadas, cada una gateada por su propio permiso.
const ADMIN_TABS: AdminTab[] = [
  { id: 'empresa', group: 'directorio', label: '🏢 Empresa', check: isDirectorioAdmin, Pane: EmpresaPane },
  { id: 'rotulo', group: 'directorio', label: '🏷️ Rótulo', check: isDirectorioAdmin, Pane: RotuloDesignPane },
  { id: 'comisionistas', group: 'directorio', label: '🤝 Comisionistas', check: isDirectorioAdmin, Pane: ComisionistasCamposPane },
  { id: 'repuestos', group: 'mantenimiento', label: '🔧 Repuestos', check: isMantenimientoAdmin, Pane: RepuestosPane },
  { id: 'sectores', group: 'mantenimiento', label: '🏭 Sectores', check: isMantenimientoAdmin, Pane: SectoresPanel },
  { id: 'fotos-pendientes', group: 'mantenimiento', label: '📷 Fotos pendientes', check: isOwner, Pane: FotosPendientesPane },
  { id: 'familias', group: 'mantenimiento', label: '🏷️ Familias', check: isOwner, Pane: FamiliasPane },
  { id: 'usuarios', group: 'general', label: '👥 Usuarios', check: p => isOwner(p) || puedeResetearContrasenas(p), Pane: UsuariosPane },
  { id: 'historial', group: 'general', label: '📜 Historial', check: isOwner, Pane: HistorialPane },
  { id: 'errores', group: 'general', label: '🐞 Errores', check: puedeVerErrores, Pane: ErroresPane },
  { id: 'papelera', group: 'general', label: '🗑️ Papelera', check: isOwner, Pane: PapeleraPane },
  { id: 'sugerencias', group: 'general', label: '💬 Sugerencias', check: puedeVerSugerencias, Pane: SugerenciasPane },
];

const GRUPOS: { id: Grupo; icon: string; label: string }[] = [
  { id: 'directorio', icon: '🗂️', label: 'Directorio' },
  { id: 'mantenimiento', icon: '🔧', label: 'Depósito' },
  { id: 'general', icon: '⚙️', label: 'General' },
];

function AdminContent() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: config } = useConfiguracionQuery();
  const [menuOpen, setMenuOpen] = useState(false);

  const nombreEmpresa = config?.empresa_nombre || 'Mi Empresa';

  const visibles = useMemo(() => ADMIN_TABS.filter(t => t.check(profile)), [profile]);
  const [tabId, setTabId] = useState<string>(() => visibles[0]?.id ?? '');

  const tabActual = visibles.find(t => t.id === tabId) ?? visibles[0];
  const grupoActivo = tabActual?.group;

  function selectGroup(group: Grupo) {
    const primera = visibles.find(t => t.group === group);
    if (primera) setTabId(primera.id);
  }

  const navItems = [{ icon: '←', label: 'Volver', onClick: () => navigate(-1) }];

  if (!tabActual) return null;

  return (
    <div className="admin-screen">
      <header className="app-header">
        <div className="header-logo">
          {config?.logo_base64 && <img src={config.logo_base64} alt={nombreEmpresa} />}
          <div>
            <div className="header-logo-fallback">{nombreEmpresa}</div>
            <div className="header-title">Configuración</div>
          </div>
        </div>
        <div className="header-right">
          <button onClick={() => navigate(-1)} className="btn-volver-directorio" style={{ display: 'flex' }}>← <span className="hide-mobile">Volver</span></button>
          <UserMenu />
          <button className="hamburger-btn" onClick={() => setMenuOpen(true)} aria-label="Menú">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="admin-group-tabs">
          {GRUPOS.filter(g => visibles.some(t => t.group === g.id)).map(g => (
            <button key={g.id} className={`admin-group-tab${grupoActivo === g.id ? ' active' : ''}`} onClick={() => selectGroup(g.id)}>
              {g.icon} <span className="admin-group-tab-label">{g.label}</span>
            </button>
          ))}
        </div>
        <div className="admin-subnav">
          {visibles.filter(t => t.group === grupoActivo).map(t => (
            <button key={t.id} className={`admin-subtab${tabId === t.id ? ' active' : ''}`} onClick={() => setTabId(t.id)}>{t.label}</button>
          ))}
        </div>

        <tabActual.Pane />
      </main>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} navItems={navItems} />
    </div>
  );
}

export default function AdminPage() {
  const { profile } = useAuth();
  if (!tieneAccesoAdmin(profile)) return <Navigate to="/" replace />;
  return <AdminContent />;
}
