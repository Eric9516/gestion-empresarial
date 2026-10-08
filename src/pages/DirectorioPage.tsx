import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isDirectorioDesactivado, tieneAccesoMantenimiento } from '../lib/types';
import UserMenu from '../components/UserMenu';
import MobileMenu from '../components/MobileMenu';
import { useConfiguracionQuery } from '../features/config/useConfiguracion';
import ProveedoresList from '../features/proveedores/ProveedoresList';
import ComisionistasList from '../features/comisionistas/ComisionistasList';
import RotulosScreen from '../features/rotulos/RotulosScreen';
import TareasScreen from '../features/tareas/TareasScreen';

type Tab = 'proveedores' | 'comisionistas' | 'rotulos' | 'tareas';

// Un usuario con Directorio desactivado (rol='disabled', no owner) no debe ver
// esta pantalla en absoluto — espeja mantenimientoOnly de mantenimiento.js.
export default function DirectorioPage() {
  const { profile } = useAuth();
  if (isDirectorioDesactivado(profile)) return <Navigate to="/mantenimiento" replace />;
  return <DirectorioContent />;
}

function DirectorioContent() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: config } = useConfiguracionQuery();
  const [tab, setTab] = useState<Tab>('proveedores');
  const [menuOpen, setMenuOpen] = useState(false);

  const nombreEmpresa = config?.empresa_nombre || 'Mi Empresa';

  useEffect(() => {
    document.title = `Directorio — ${nombreEmpresa}`;
  }, [nombreEmpresa]);

  const navItems = [
    { icon: '🏭', label: 'Proveedores', onClick: () => setTab('proveedores'), active: tab === 'proveedores' },
    { icon: '🤝', label: 'Comisionistas', onClick: () => setTab('comisionistas'), active: tab === 'comisionistas' },
    { icon: '📦', label: 'Envíos', onClick: () => setTab('rotulos'), active: tab === 'rotulos' },
    { icon: '✅', label: 'Tareas', onClick: () => setTab('tareas'), active: tab === 'tareas' },
    ...(tieneAccesoMantenimiento(profile) ? [{ icon: '🔧', label: 'Depósito', onClick: () => navigate('/mantenimiento') }] : []),
  ];

  return (
    <div className="app-screen">
      <header className="app-header">
        <div className="header-logo">
          {config?.logo_base64 && <img src={config.logo_base64} alt={nombreEmpresa} />}
          <div>
            <div className="header-logo-fallback">{nombreEmpresa}</div>
            <div className="header-title">Directorio</div>
          </div>
        </div>
        <div className="header-right">
          {tieneAccesoMantenimiento(profile) && (
            <Link to="/mantenimiento" className="btn-mantenimiento" title="Depósito de mantenimiento" style={{ display: 'flex' }}>🔧 <span className="hide-mobile">Depósito</span></Link>
          )}
          <UserMenu />
          <button className="hamburger-btn" onClick={() => setMenuOpen(true)} aria-label="Menú">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <button className={`nav-tab${tab === 'proveedores' ? ' active' : ''}`} onClick={() => setTab('proveedores')}>🏭 Proveedores</button>
        <button className={`nav-tab${tab === 'comisionistas' ? ' active' : ''}`} onClick={() => setTab('comisionistas')}>🤝 Comisionistas</button>
        <button className={`nav-tab${tab === 'rotulos' ? ' active' : ''}`} onClick={() => setTab('rotulos')}>📦 Envíos</button>
        <button className={`nav-tab${tab === 'tareas' ? ' active' : ''}`} onClick={() => setTab('tareas')}>✅ Tareas</button>
      </nav>

      <main className="app-main">
        {tab === 'proveedores' && <ProveedoresList />}
        {tab === 'comisionistas' && <ComisionistasList />}
        {tab === 'rotulos' && <RotulosScreen />}
        {tab === 'tareas' && <TareasScreen />}
      </main>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} navItems={navItems} />
    </div>
  );
}
