// Edge Function: reset-password
// Le fuerza una contraseña nueva a otro usuario usando la clave secreta del
// proyecto. Puede ejecutarla el propietario, o cualquier usuario con el
// permiso puede_resetear_contrasenas — pero nadie que no sea el propietario
// puede resetearle la contraseña AL propietario, y no te la podés resetear a
// vos mismo por acá.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

// Supabase inyecta estos dos valores solo en cada proyecto, sin configurar
// nada — así esta función funciona igual en cualquier instalación, sin tener
// la dirección de ESTE proyecto particular escrita adentro.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Falta el header de autorización');

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) throw new Error('No autenticado');

    const { data: perfil, error: perfilErr } = await supabaseAuth
      .from('usuarios_perfil')
      .select('puede_resetear_contrasenas, es_owner, nombre, apellido, activo')
      .eq('id', user.id)
      .single();
    if (perfilErr) throw perfilErr;
    if (perfil?.activo !== true) throw new Error('No autorizado — tu cuenta está desactivada');
    const esOwner = perfil?.es_owner === true;
    if (!esOwner && perfil?.puede_resetear_contrasenas !== true) {
      throw new Error('No autorizado — no tenés permiso para resetear contraseñas');
    }

    const { userId, password } = await req.json();
    if (!userId || !password) throw new Error('Faltan datos obligatorios');
    if (userId === user.id) throw new Error('No podés resetear tu propia contraseña por acá');
    if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');

    const secretKey = Deno.env.get('PROJECT_SECRET_KEY');
    if (!secretKey) throw new Error('Falta configurar el secreto PROJECT_SECRET_KEY en la función');

    const supabaseAdmin = createClient(SUPABASE_URL, secretKey);

    if (!esOwner) {
      const { data: objetivo, error: objetivoErr } = await supabaseAdmin
        .from('usuarios_perfil')
        .select('es_owner')
        .eq('id', userId)
        .single();
      if (objetivoErr) throw objetivoErr;
      if (objetivo?.es_owner === true) throw new Error('No podés resetear la contraseña del propietario');
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (updateErr) throw updateErr;

    // Queda en el historial quién restableció la contraseña de quién (nunca la contraseña).
    // Si el registro falla no se deshace el cambio: se avisa en el log de la función.
    const { data: afectado } = await supabaseAdmin.from('usuarios_perfil').select('nombre, apellido, email').eq('id', userId).maybeSingle();
    const { error: auditErr } = await supabaseAdmin.from('audit_log').insert({
      tabla: 'usuarios_perfil',
      registro_id: userId,
      descripcion: `Contraseña restablecida: ${[afectado?.nombre, afectado?.apellido].filter(Boolean).join(' ') || afectado?.email || userId}`,
      accion: 'update',
      usuario_id: user.id,
      usuario_nombre: [perfil?.nombre, perfil?.apellido].filter(Boolean).join(' ') || null,
      usuario_email: user.email ?? null,
    });
    if (auditErr) console.error('No se pudo registrar el cambio de contraseña en la auditoría:', auditErr.message);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
