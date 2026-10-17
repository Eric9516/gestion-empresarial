import { useRef, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import { Icono } from '@/components/Icono';
import { textoDeAviso } from '../features/avisos/useAvisos';
import { POSICIONES_MENU, type PosicionMenu } from '../lib/preferencias';

export interface ItemMenu {
  clave: string;
  icono: ReactNode;
  titulo: string;
  onClick: () => void;
  activo?: boolean;
  /** Número chico sobre el ícono (por ejemplo, lo que hay en "A retirar"). */
  cantidad?: number;
}

export interface SeccionMenu {
  titulo: string;
  items: ItemMenu[];
}

interface Props {
  secciones: SeccionMenu[];
  /** Lo que va al final, separado (por ejemplo, Configuración). */
  pie?: ItemMenu[];
  /** Dónde lo eligió poner la persona (en la computadora). En el celular manda el menú de la hamburguesa. */
  posicion: PosicionMenu;
  onCambiarPosicion: (p: PosicionMenu) => void;
  /** Solo para la posición lateral: queda abierto en vez de desplegarse al acercar el mouse. */
  fijo: boolean;
  onAlternarFijo: () => void;
}

const ICONO_POSICION = { lateral: 'menuLateral', arriba: 'menuArriba', abajo: 'menuAbajo' } as const;

// Tres botones para elegir dónde va el menú. Lo elegido queda guardado en el perfil de cada persona.
function SelectorDePosicion({ posicion, onCambiar }: { posicion: PosicionMenu; onCambiar: (p: PosicionMenu) => void }) {
  return (
    <div className="menu-selector" role="radiogroup" aria-label="Dónde va el menú">
      {POSICIONES_MENU.map(p => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={posicion === p.id}
          aria-label={p.nombre}
          title={p.nombre}
          className={`menu-selector-boton${posicion === p.id ? ' activo' : ''}`}
          onClick={() => onCambiar(p.id)}
        >
          <Icono n={ICONO_POSICION[p.id]} />
        </button>
      ))}
    </div>
  );
}

function ItemLateral({ item, alElegir }: { item: ItemMenu; alElegir: () => void }) {
  return (
    <button type="button" className={`menu-lateral-item${item.activo ? ' activo' : ''}`} aria-current={item.activo ? 'page' : undefined} onClick={() => { item.onClick(); alElegir(); }}>
      <span className="menu-lateral-icono">{item.icono}</span>
      <span className="menu-lateral-texto">{item.titulo}</span>
      {!!item.cantidad && <span className="menu-lateral-cant">{textoDeAviso(item.cantidad)}</span>}
    </button>
  );
}

function ItemBarra({ item }: { item: ItemMenu }) {
  return (
    <button type="button" className={`nav-tab${item.activo ? ' active' : ''}`} aria-current={item.activo ? 'page' : undefined} onClick={item.onClick}>
      {item.icono} {item.titulo}
      {!!item.cantidad && <span className="aviso-numero">{textoDeAviso(item.cantidad)}</span>}
    </button>
  );
}

// Menú de las secciones de la pantalla, en la computadora. Cada persona elige dónde lo quiere:
// · a la izquierda: una franja angosta de íconos que flota sobre la pantalla (no le quita ancho al contenido) y, al acercar el mouse
//   o entrar con el teclado, se ensancha por encima mostrando los nombres (o queda fijo abierto);
// · arriba, debajo del encabezado, como pestañas; o abajo, como una barra pegada al borde.
// En el celular no se ve: ahí está el menú de la hamburguesa.
export default function MenuSecciones({ secciones, pie = [], posicion, onCambiarPosicion, fijo, onAlternarFijo }: Props) {
  const [adentro, setAdentro] = useState(false);
  const ref = useRef<HTMLElement>(null);

  if (posicion !== 'lateral') {
    return (
      <nav className={`app-nav menu-barra menu-barra-${posicion}`} aria-label="Secciones">
        {secciones.map((seccion, i) => (
          <div key={seccion.titulo} className="menu-barra-grupo" role="group" aria-label={seccion.titulo}>
            {i > 0 && <span className="menu-barra-separador" aria-hidden="true" />}
            {seccion.items.map(item => <ItemBarra key={item.clave} item={item} />)}
          </div>
        ))}
        <div className="menu-barra-fin">
          {pie.map(item => <ItemBarra key={item.clave} item={item} />)}
          <SelectorDePosicion posicion={posicion} onCambiar={onCambiarPosicion} />
        </div>
      </nav>
    );
  }

  const abierto = fijo || adentro;
  // Con el teclado se abre al enfocar; con el mouse, al pasar por encima (el clic no lo deja trabado).
  function alEnfocar(e: FocusEvent<HTMLElement>) {
    if (e.target.matches(':focus-visible')) setAdentro(true);
  }
  function alSalirElFoco(e: FocusEvent<HTMLElement>) {
    if (!ref.current?.contains(e.relatedTarget as Node | null)) setAdentro(false);
  }
  // Al elegir una sección el menú se repliega y deja ver la pantalla; para volver a abrirlo se saca el mouse y se vuelve a entrar.
  const cerrar = () => setAdentro(false);

  return (
    <nav
      ref={ref}
      className={`menu-lateral${abierto ? ' abierto' : ''}${fijo ? ' fijo' : ''}`}
      aria-label="Secciones"
      onMouseEnter={() => setAdentro(true)}
      onMouseLeave={() => setAdentro(false)}
      onFocus={alEnfocar}
      onBlur={alSalirElFoco}
      onKeyDown={e => { if (e.key === 'Escape') setAdentro(false); }}
    >
      <div className="menu-lateral-medio">
        {secciones.map((seccion, i) => (
          <div key={seccion.titulo} role="group" aria-label={seccion.titulo}>
            <div className={`menu-lateral-grupo${i === 0 ? ' primero' : ''}`}>
              <span aria-hidden="true">{seccion.titulo}</span>
              {i === 0 && <SelectorDePosicion posicion={posicion} onCambiar={onCambiarPosicion} />}
            </div>
            {seccion.items.map(item => <ItemLateral key={item.clave} item={item} alElegir={cerrar} />)}
          </div>
        ))}
      </div>
      <div className="menu-lateral-pie">
        {pie.map(item => <ItemLateral key={item.clave} item={item} alElegir={cerrar} />)}
        <button type="button" className="menu-lateral-item" onClick={onAlternarFijo} aria-pressed={fijo}>
          <span className="menu-lateral-icono"><Icono n="fijar" /></span>
          <span className="menu-lateral-texto">{fijo ? 'Soltar menú' : 'Dejar fijo'}</span>
        </button>
      </div>
    </nav>
  );
}
