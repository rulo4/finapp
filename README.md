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

## Requisitos para desarrollo local
- Node.js 20 o superior
- npm
- Docker Desktop ejecutándose
- Supabase CLI instalada

## Como corre localmente
Este proyecto no necesita un `docker-compose` propio para Supabase.

La razon es que usamos Supabase CLI y ella misma levanta y administra los contenedores Docker necesarios para desarrollo local, incluyendo base de datos, Auth, Studio y servicios auxiliares.

En local, la separacion es esta:
- frontend React + Vite: `http://127.0.0.1:5173`
- API local de Supabase: `http://127.0.0.1:54321`
- base de datos Postgres local: `127.0.0.1:54322`
- Supabase Studio local: `http://127.0.0.1:54323`

Si en Docker Desktop ves varios contenedores `supabase_*`, eso es esperado.

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

## Arranque rapido local
1. Instala dependencias del frontend con `npm install`.
2. Inicia Docker Desktop si no esta activo.
3. Levanta Supabase local con `npm run supabase:start`.
4. Revisa credenciales y puertos con `npm run supabase:status`.
5. Copia `.env.example` a `.env.local`.
6. En `.env.local`, usa estos valores para local:
	- `VITE_SUPABASE_URL=http://127.0.0.1:54321`
	- `VITE_SUPABASE_ANON_KEY=<valor anon publicado por npm run supabase:status>`
7. Inicia el frontend con `npm run dev`.
8. Abre la app en `http://127.0.0.1:5173`.

Con eso deberias poder registrarte e iniciar sesion contra el entorno local de Supabase.

## Primer usuario de prueba local
1. Abre la app en `http://127.0.0.1:5173`.
2. En la pantalla de autenticacion, registra un correo y password nuevos.
3. Inicia sesion con ese mismo usuario.
4. Captura algunos ingresos o egresos para validar que RLS funciona con tu sesion.

En local, la confirmacion por correo esta desactivada, asi que el acceso es inmediato despues del registro.

## Documentacion operativa
- despliegue completo de `staging` y `production`: [DEPLOY.md](DEPLOY.md)
- plan funcional original: [plan-finapp.prompt.md](plan-finapp.prompt.md)

## Supabase local
- levantar stack: `npm run supabase:start`
- revisar estado y credenciales: `npm run supabase:status`
- abrir Studio: `http://127.0.0.1:54323`
- detener stack: `npm run supabase:stop`
- reinicializar base y reaplicar migraciones: `npm run supabase:reset`

Flujo recomendado:
- usar `npm run supabase:start` la primera vez o cuando reinicies Docker
- usar `npm run supabase:status` para obtener el `anon key` local correcto
- usar `npm run supabase:reset` cuando necesites reconstruir el esquema desde migraciones

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
- `npm run dev:remote`
- `npm run build`
- `npm run preview`
- `npm run supabase:start`
- `npm run supabase:status`
- `npm run supabase:stop`
- `npm run supabase:reset`

## Probar Contra Supabase Remoto
- crea `.env.remote` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del proyecto remoto
- ejecuta `npm run dev:remote`
- Vite cargara `.env.remote` automaticamente porque el script usa `--mode remote`
- `.env.local` se mantiene intacto para seguir usando el entorno local con `npm run dev`

## Troubleshooting rapido
- Si `npm run dev` levanta pero no puedes autenticarte, revisa primero `.env.local`.
- Si Supabase no arranca, confirma que Docker Desktop este iniciado.
- Si cambias migraciones y el schema queda inconsistente, usa `npm run supabase:reset`.
- Si los puertos `54321`, `54322` o `54323` estan ocupados, revisa conflictos locales antes de arrancar Supabase.

## Estado
Esta primera base ya tiene:
- estructura, navegacion y placeholders de modulos
- cliente Supabase conectado por variables de entorno
- stack local de Supabase operativo por Docker
- verificacion visible en dashboard para distinguir configuracion y conectividad real
- autenticacion base y proteccion por sesion
- RLS para separar datos por usuario autenticado

El siguiente paso natural es reemplazar los datos placeholder por lecturas y escrituras reales contra Supabase.
