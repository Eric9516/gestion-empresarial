// `npx` falso: atiende `npx [--yes] supabase ...` mandando el pedido al Supabase local. Todo lo demás lo rechaza.
const control = process.env.SUPABASE_LOCAL_CONTROL;
if (!control) { console.error('Falta SUPABASE_LOCAL_CONTROL: este npx es solo para las pruebas con el Supabase local.'); process.exit(127); }
const args = process.argv.slice(2);
const sinYes = args.filter((a, i) => !(i === 0 && a === '--yes'));
if (sinYes[0] !== 'supabase') { console.error(`npx falso: solo atiende "supabase" (pidieron: ${sinYes[0]})`); process.exit(127); }
const r = await fetch(control, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: sinYes.slice(1), cwd: process.cwd() }) });
const { salida, error, codigo } = await r.json();
if (salida) process.stdout.write(salida);
if (error) process.stderr.write(error);
process.exit(codigo ?? 1);
