import { useEffect } from 'react';
import { useConfiguracionQuery } from '../features/config/useConfiguracion';
import { aplicarMarca } from '../lib/marca';

// No dibuja nada: aplica los colores de marca de la empresa a toda la app (también al
// login, porque la configuración se puede leer antes de iniciar sesión).
export default function AplicarMarca() {
  const { data: config } = useConfiguracionQuery();
  const primario = config?.color_primario;
  const deposito = config?.color_deposito;

  useEffect(() => {
    aplicarMarca(document.documentElement, { primario, deposito });
  }, [primario, deposito]);

  return null;
}
