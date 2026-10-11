-- Se corre UNA vez, como administrador de la base (el usuario "postgres" del contenedor), así:
--
--   psql -v clave="'LA-CLAVE-LARGA-QUE-ELIJAS'" -f instalar.sql panel
--
-- y después se carga schema.sql con el mismo usuario. El usuario "panel_app" queda con permiso SOLO para ejecutar
-- las funciones panel_*: no puede leer ni escribir tablas, ni crear nada, ni ver otras bases.

create role panel_app login password :clave nosuperuser nocreatedb nocreaterole noinherit connection limit 12;
alter role panel_app set statement_timeout = '20s';
alter role panel_app set idle_in_transaction_session_timeout = '15s';
revoke all on schema public from public;
grant usage on schema public to panel_app;
