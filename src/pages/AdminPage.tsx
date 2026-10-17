import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isDirectorioAdmin, isMantenimientoAdmin, isOwner, puedeResetearContrasenas, puedeVerErrores, puedeVerSugerencias, tieneAccesoAdmin, type Profile } from '../lib/types';
import UserMenu from '../components/UserMenu';
import MobileMenu from '../components/MobileMenu';
import type { ModuloId } from '../lib/modulos';
import { useConfiguracionQuery } from '../features/config/useConfiguracion';
import { useModulos } from '../features/config/useModulos';
import ConfiguracionInicial from '../features/inicial/ConfiguracionInicial';
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
import ModulosPane from '../features/admin/ModulosPane';
import { Icono } from '@/components/Icono';
import type { NombreIcono } from '@/components/Icono';
import MenuLateral from '../components/MenuLateral';
import type { SeccionMenu } from '../components/MenuLateral';
import { useMenuFijo } from '../lib/useMenuFijo';


type Grupo = 'directorio' | 'mantenimiento' | 'general';

interface AdminTab {
  id: string;
  group: Grupo;
  icono: NombreIcono;
  label: string;
  check: (profile: Profile | null) => boolean;
  // Si el módulo está desactivado, la pestaña no aparece (la configuración de algo que no se usa no sirve).
  modulo?: ModuloId;
  Pane: () => ReactElement;
}

// Espeja ADMIN_TABS de main.js: una sola pantalla de Configuración con pestañas
// agrupadas, cada una gateada por su propio permiso.
const ADMIN_TABS: AdminTab[] = [
  // El asistente se abre solo la primera vez que entra el dueño (ver PuertaConfiguracionInicial) y
  // queda siempre acá para retomarlo.
  { id: 'inicial', group: 'general', icono: 'cohete', label: 'Configuración inicial', check: isOwner, Pane: ConfiguracionInicial },
  // Empresa sirve a toda la aplicación, por eso está en General.
  { id: 'empresa', group: 'general', icono: 'empresa', label: 'Empresa', check: isDirectorioAdmin, Pane: EmpresaPane },
  { id: 'rotulo', group: 'directorio', icono: 'etiqueta', label: 'Rótulo', check: isDirectorioAdmin, modulo: 'envios', Pane: RotuloDesignPane },
  { id: 'comisionistas', group: 'directorio', icono: 'acuerdo', label: 'Comisionistas', check: isDirectorioAdmin, modulo: 'comisionistas', Pane: ComisionistasCamposPane },
  { id: 'repuestos', group: 'mantenimiento', icono: 'herramienta', label: 'Repuestos', check: isMantenimientoAdmin, modulo: 'deposito', Pane: RepuestosPane },
  { id: 'sectores', group: 'mantenimiento', icono: 'fabrica', label: 'Sectores', check: isMantenimientoAdmin, modulo: 'deposito', Pane: SectoresPanel },
  { id: 'fotos-pendientes', group: 'mantenimiento', icono: 'camara', label: 'Fotos pendientes', check: isOwner, modulo: 'deposito', Pane: FotosPendientesPane },
  { id: 'familias', group: 'mantenimiento', icono: 'etiqueta', label: 'Familias', check: isOwner, modulo: 'deposito', Pane: FamiliasPane },
  // Solo el dueño: apaga o prende, dentro de su plan, los módulos que usa (lo que el plan incluye lo define quien vende).
  { id: 'modulos', group: 'general', icono: 'modulos', label: 'Módulos', check: isOwner, Pane: ModulosPane },
  { id: 'usuarios', group: 'general', icono: 'usuarios', label: 'Usuarios', check: p => isOwner(p) || puedeResetearContrasenas(p), Pane: UsuariosPane },
  { id: 'historial', group: 'general', icono: 'historial', label: 'Historial', check: isOwner, Pane: HistorialPane },
  { id: 'errores', group: 'general', icono: 'error', label: 'Errores', check: puedeVerErrores, Pane: ErroresPane },
  { id: 'papelera', group: 'general', icono: 'borrar', label: 'Papelera', check: isOwner, Pane: PapeleraPane },
  { id: 'sugerencias', group: 'general', icono: 'mensaje', label: 'Sugerencias', check: puedeVerSugerencias, Pane: SugerenciasPane },
];

const GRUPOS: { id: Grupo; label: string }[] = [
  { id: 'directorio', label: 'Directorio' },
  { id: 'mantenimiento', label: 'Depósito' },
  { id: 'general', label: 'General' },
];

function AdminContent() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: config } = useConfiguracionQuery();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFijo, alternarMenuFijo] = useMenuFijo();

  const { modulos, listo } = useModulos();

  const nombreEmpresa = config?.empresa_nombre || 'Mi Empresa';
  useEffect(() => { document.title = `Configuración — ${nombreEmpresa}`; }, [nombreEmpresa]);

  const visibles = useMemo(
    () => ADMIN_TABS.filter(t => t.check(profile) && (!t.modulo || modulos[t.modulo])),
    [profile, modulos],
  );
  const [tabId, setTabId] = useState<string>('');

  // Mientras el asistente no se cerró, es lo primero que se ve; después, la primera pestaña "de trabajo".
  const asistentePendiente = !!config && config.inicial_cerrada_at == null;
  const porDefecto = (asistentePendiente && visibles.find(t => t.id === 'inicial'))
    || visibles.find(t => t.id !== 'inicial') || visibles[0];

  const tabActual = visibles.find(t => t.id === tabId) ?? porDefecto;

  // El menú lateral muestra cada grupo con sus pestañas; la hamburguesa del celular, lo mismo en una sola lista.
  const secciones: SeccionMenu[] = GRUPOS
    .map(g => ({ titulo: g.label, items: visibles.filter(t => t.group === g.id).map(t => ({ clave: t.id, icono: <Icono n={t.icono} />, titulo: t.label, onClick: () => setTabId(t.id), activo: tabActual?.id === t.id })) }))
    .filter(s => s.items.length > 0);
  const navItems = [
    ...secciones.flatMap(s => s.items).map(i => ({ icon: i.icono, label: i.titulo, onClick: i.onClick, active: i.activo })),
    { icon: <><Icono n="volver" /> </>, label: 'Volver', onClick: () => navigate(-1) },
  ];

  if (!listo) return <div className="loading-screen">Cargando...</div>;
  if (!tabActual) return null;

  return (
    <div className={`admin-screen con-menu-lateral${menuFijo ? ' menu-fijo' : ''}`}>
      <header className="app-header">
        <div className="header-logo">
          {config?.logo_base64 && <img src={config.logo_base64} alt={nombreEmpresa} />}
          <div>
            <div className="header-logo-fallback">{nombreEmpresa}</div>
            <h1 className="header-title">Configuración</h1>
          </div>
        </div>
        <div className="header-right">
          <button onClick={() => navigate(-1)} className="btn-volver-directorio" style={{ display: 'flex' }}><Icono n="volver" /> <span className="hide-mobile">Volver</span></button>
          <UserMenu />
          <button className="hamburger-btn" onClick={() => setMenuOpen(true)} aria-label="Menú">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      <MenuLateral secciones={secciones} fijo={menuFijo} onAlternarFijo={alternarMenuFijo} />

      <main className="app-main">
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
