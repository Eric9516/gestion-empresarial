import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { tieneAccesoAdmin } from '../lib/types';
import { Button } from '@/components/ui/button';

// Se muestra cuando la persona no tiene ninguna pantalla disponible: por ejemplo, el dueño
// desactivó todos los módulos a los que ella tiene acceso. Siempre ofrece una salida.
export default function SinModulos() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="loading-screen" style={{ flexDirection: 'column', gap: 12, textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 40 }}>🧩</div>
      <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>No hay módulos disponibles</div>
      <p style={{ maxWidth: 380, color: 'var(--text-mid)', fontSize: 14 }}>
        Los módulos a los que tenés acceso están desactivados. Pedile al dueño del sistema que los active en Configuración → General → Módulos.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {tieneAccesoAdmin(profile) && <Button variant="primary" onClick={() => navigate('/admin')}>Ir a Configuración</Button>}
        <Button variant="ghost" onClick={() => void signOut()}>Cerrar sesión</Button>
      </div>
    </div>
  );
}
