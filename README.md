# Finapp

Proyecto inicial para una app de finanzas personales con React 19, TypeScript, Vite y Supabase.

## Stack recomendado
- frontend: Cloudflare Pages
- backend, auth y base de datos: Supabase Cloud
- repositorio y control de cambios: GitHub

Motivo:
- costo inicial muy bajo o gratuito para uso moderado
- despliegue sencillo para una app Vite estatica
- no requiere servidor Node dedicado
- encaja con el cliente actual de Supabase en [src/lib/supabase/client.ts](src/lib/supabase/client.ts)

## Incluye
- navegación lateral por módulos
- páginas placeholder para ingresos, egresos, inversiones, compras, ventas, dividendos y catálogos
- base visual tipo tabla editable con `react-data-grid`
- cliente Supabase listo para conectar vía variables de entorno
- carpeta `supabase/` con configuración y migración inicial

## Variables de entorno
Copia `.env.example` a `.env.local` y configura:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Valores de ejemplo para desarrollo local:
- `VITE_SUPABASE_URL=http://127.0.0.1:54321`
- `VITE_SUPABASE_ANON_KEY=<obtenla_con_supabase_status_o_desde_tu_stack_local>`

Reglas de seguridad:
- no subir a git claves reales de ningun entorno
- no documentar ni compartir `service_role` en frontend, README, issues o chat
- el `anon key` de Supabase no es secreto de servidor, pero tampoco conviene publicar valores reales de produccion innecesariamente
- toda clave real debe vivir en variables de entorno de la plataforma de despliegue

## Documentacion operativa
- despliegue completo de `staging` y `production`: [DEPLOY.md](DEPLOY.md)
- plan funcional original: [plan-finapp.prompt.md](plan-finapp.prompt.md)

## Supabase local
- levantar stack: `npx supabase start`
- revisar estado y credenciales: `npx supabase status`
- abrir Studio: `http://127.0.0.1:54323`
- reinicializar base y reaplicar migraciones: `npx supabase db reset`

Migraciones actuales del proyecto:
- `supabase/migrations/001_init.sql`
- `supabase/migrations/002_auth_rls.sql`
- `supabase/migrations/003_unit_of_measures.sql`
- `supabase/migrations/004_expense_subtotal_semantics.sql`

## Autenticacion y RLS
- la app ahora requiere iniciar sesion antes de acceder a los modulos
- el flujo base usa email y password con Supabase Auth
- el entorno local desactiva confirmacion por correo para acelerar pruebas
- las tablas de catalogos e ingresos/egresos quedan aisladas por `auth.uid()` mediante RLS
- egresos usa un catalogo de unidades de medida en lugar de texto libre
- en egresos, `subtotal_original` es ahora el dato principal capturado; `unit_cost_original` queda derivado por compatibilidad

La migracion base actual vive en `supabase/migrations/001_init.sql` e incluye catalogos y tablas iniciales de ingresos y egresos.

## Scripts
- `npm run dev`
- `npm run build`
- `npm run preview`

## Estado
Esta primera base ya tiene:
- estructura, navegacion y placeholders de modulos
- cliente Supabase conectado por variables de entorno
- stack local de Supabase operativo por Docker
- verificacion visible en dashboard para distinguir configuracion y conectividad real
- autenticacion base y proteccion por sesion
- RLS para separar datos por usuario autenticado

El siguiente paso natural es reemplazar los datos placeholder por lecturas y escrituras reales contra Supabase.
