# Deployment Guide

Guia operativa para publicar Finapp con el stack recomendado:
- frontend: Cloudflare Pages
- backend, auth y base de datos: Supabase Cloud
- repositorio: GitHub

La recomendacion actual es desplegar primero como beta controlada, no como V1 final completa, porque el alcance implementado todavia es menor que el plan original en [plan-finapp.prompt.md](plan-finapp.prompt.md).

## Cuentas necesarias
Obligatorias:
- GitHub
- Supabase
- Cloudflare

Opcionales:
- registrador de dominio o cuenta DNS si vas a usar dominio propio
- proveedor de correo transaccional si activas confirmacion o recovery por email en produccion
- herramienta de monitoreo de errores si despues quieres observabilidad

## Si aun no has creado ninguna cuenta
Orden recomendado:
1. GitHub
2. Supabase
3. Cloudflare

Motivo:
- GitHub es la base para conectar el despliegue automatico
- Supabase conviene crearlo antes para obtener `Project URL` y `anon key`
- Cloudflare Pages se configura al final, cuando ya exista repositorio y backend

## Arranque desde cero
### Paso 1. Crear cuenta en GitHub
Necesitas:
- una cuenta personal de GitHub
- el repositorio del proyecto publicado ahi

Si el repo aun no existe, ese es el primer paso real antes de tocar Supabase o Cloudflare.

### Paso 2. Crear cuenta en Supabase
Necesitas:
- una cuenta en Supabase
- crear un proyecto nuevo, aunque sea de `staging`

Resultado esperado:
- tendras `Project URL`
- tendras `anon key`
- tendras `service_role key`, que solo se guarda de forma privada y no se usa en frontend

### Paso 3. Crear cuenta en Cloudflare
Necesitas:
- una cuenta en Cloudflare
- acceso a Pages

Resultado esperado:
- podras conectar el repositorio GitHub
- podras cargar variables de entorno del frontend
- obtendras una URL publica para probar login y la app completa

## Lo minimo para avanzar hoy
Si todavia no tienes nada creado, el camino minimo es este:
1. crear cuenta en GitHub
2. subir este proyecto a un repositorio
3. crear cuenta en Supabase
4. crear un proyecto Supabase de `staging`
5. crear cuenta en Cloudflare
6. conectar el repo a Cloudflare Pages

Con eso ya puedes tener una primera beta funcional sin tocar todavia dominio propio, correo transaccional ni monitoreo.

## Alcance recomendado para publicar ahora
Publicar como beta cerrada con:
- autenticacion
- ingresos
- egresos
- catalogos
- layout principal y navegacion

Evitar anunciar como V1 final mientras existan modulos placeholder o incompletos.

## Arquitectura objetivo
- frontend: Cloudflare Pages
- auth y base de datos: Supabase Cloud
- fuente de verdad del codigo: GitHub

## Estrategia de entornos
- `local`: `npm run supabase:start` + `npm run dev`
- `staging`: proyecto Supabase Cloud de pruebas + proyecto Pages de pruebas o previews por rama
- `production`: proyecto Supabase Cloud productivo + proyecto Pages productivo

No mezclar datos ni claves entre `staging` y `production`.

## Checklist de staging
### 1. Repositorio
1. Confirmar que el codigo esta en GitHub.
2. Confirmar que [.gitignore](.gitignore) contiene `.env.local`, `.env` y artefactos locales.
3. Ejecutar `npm install` si hace falta sincronizar dependencias.
4. Ejecutar `npm run build` y corregir cualquier error antes de desplegar.
5. Confirmar que las migraciones en `supabase/migrations/` representan el estado real a desplegar.

### 2. Proyecto Supabase Cloud de staging
1. Crear un proyecto nuevo en Supabase Cloud.
2. Elegir una region cercana a los usuarios esperados.
3. Guardar en un gestor seguro:
   - `Project URL`
   - `anon key`
   - `service_role key`
   - password de base de datos
4. En `Authentication > Providers`, habilitar `Email`.
5. No reutilizar un proyecto de pruebas para produccion.

### 3. Vincular CLI y empujar esquema
Comandos:

```bash
supabase login
supabase link --project-ref <staging-project-ref>
supabase db push
```

Validacion:
- abrir Supabase Studio
- confirmar tablas esperadas
- confirmar politicas RLS
- confirmar columnas derivadas y catalogos esperados

Migraciones actuales del repo:
- `supabase/migrations/001_init.sql`
- `supabase/migrations/002_auth_rls.sql`
- `supabase/migrations/003_unit_of_measures.sql`
- `supabase/migrations/004_expense_subtotal_semantics.sql`

### 4. Cargar datos base en staging
Minimo requerido:
- `income_sources`
- `expense_categories`
- `payment_instruments`
- `stores`
- `unit_of_measures`

Sin estos catalogos, la captura operativa queda incompleta.

Opciones:
- usar inserts manuales desde Supabase Studio
- crear un script o seed SQL controlado si luego quieres repetir el proceso

### 5. Crear proyecto Cloudflare Pages para staging
1. En Cloudflare Pages, conectar el repositorio GitHub.
2. Configurar:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Configurar variables de entorno:
   - `VITE_SUPABASE_URL=https://<staging-project>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<staging-anon-key>`
4. Lanzar el primer deploy.

## Configuracion exacta de Auth en staging
En Supabase `Authentication > URL Configuration` registrar:
- `Site URL`: URL publica del proyecto Pages de staging
- `Redirect URLs`: URL publica del proyecto Pages de staging

Si luego agregas rutas especificas de callback, registrarlas tambien ahi.

## Validacion funcional de staging
Checklist minima:
1. Crear una cuenta de prueba real.
2. Iniciar sesion.
3. Confirmar navegacion protegida.
4. Crear, editar y eliminar ingresos.
5. Crear, editar y eliminar egresos.
6. Validar catalogos.
7. Confirmar que un usuario no puede ver datos de otro usuario.
8. Probar desde movil y escritorio.

## Paso a produccion
Repetir el mismo flujo con recursos separados.

### 1. Crear recursos separados
- nuevo proyecto Supabase Cloud para produccion
- nuevo proyecto Pages para produccion o configuracion claramente separada

### 2. Aplicar esquema
Comandos:

```bash
supabase link --project-ref <production-project-ref>
supabase db push
```

### 3. Cargar catalogos base
Cargar los mismos catalogos minimos tambien en produccion.

### 4. Configurar variables de entorno de produccion
Solo estas en frontend:
- `VITE_SUPABASE_URL=https://<production-project>.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<production-anon-key>`

No configurar en frontend:
- `SUPABASE_SERVICE_ROLE_KEY`
- passwords de base de datos
- tokens administrativos

### 5. Configurar URLs de Auth
En Supabase `Authentication > URL Configuration`:
- `Site URL`: URL real de produccion
- `Redirect URLs`: URL real de produccion

### 6. Validar antes de abrir acceso
1. Crear un usuario final de prueba.
2. Verificar login y logout.
3. Verificar sesiones persistentes.
4. Verificar RLS con mas de un usuario.
5. Confirmar que no hay errores visibles en consola o red.

## Dominio propio
Si vas a usar dominio propio:
1. Configurarlo en Cloudflare Pages.
2. Ajustar DNS.
3. Actualizar `Site URL` y `Redirect URLs` en Supabase.
4. Reprobar login, logout y cualquier flujo de email.

## Comandos utiles
```bash
npm run dev
npm run build
npm run preview
npm run supabase:start
npm run supabase:status
npm run supabase:stop
npm run supabase:reset
```

## Seguridad y privacidad
Checklist minima antes de abrir produccion:
- no hay secretos reales en el repo
- no hay claves reales en [README.md](README.md) ni en este documento
- no se usa `service_role` en el frontend
- RLS esta activo y validado con mas de un usuario
- `staging` y `production` usan proyectos distintos
- las URLs de Auth coinciden exactamente con el dominio publicado

Notas:
- el `anon key` no sustituye RLS; solo habilita el acceso publico controlado por politicas
- no asumas que el schema cloud coincide con local si no corriste `supabase db push`
- si luego automatizas esto con CI, los secretos deben vivir en GitHub Actions o Cloudflare, no en el repo