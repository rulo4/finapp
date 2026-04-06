# Arquitectura de tours guiados

## Objetivo

Este repositorio adopta una arquitectura mínima y consistente para tours guiados de producto.

La decisión actual es usar `driver.js` como base para implementar tours independientes por página. No se diseñarán, por defecto, tours complejos que coordinen navegación entre rutas.

Este documento define el patrón que debe seguirse cada vez que se implemente un tour nuevo, de forma que distintas iteraciones mantengan la misma estructura y el mismo nivel de desac acoplamiento.

## Principios

- Los tours deben ser independientes por página.
- La integración debe quedar lo más desacoplada posible de la lógica principal de cada módulo.
- La implementación debe ser simple de mantener y simple de extender.
- El mismo tour debe funcionar razonablemente bien en escritorio y móvil.
- El estilo visual del tour debe poder adaptarse con CSS del proyecto.
- El texto dentro del tour debe ser breve, claro y en español.

## Decisión de librería

Se elige `driver.js` por estas razones:

- Permite una capa de integración pequeña y externa al árbol principal de React.
- Se adapta bien a tours cortos y locales por pantalla.
- Facilita tematización por clases y CSS propios.
- Evita introducir una dependencia excesiva del estado React para una necesidad que no requiere tours entre páginas.

`react-joyride` sigue siendo una alternativa válida, pero en este repositorio se considera segunda opción para esta necesidad concreta.

## Alcance actual

Patrón soportado:

- Tours por página.
- Lanzamiento manual desde la pantalla actual.
- Lanzamiento automático opcional una sola vez por página.
- Persistencia local de estado de tour visto.

Patrón fuera de alcance por ahora:

- Tours que crucen varias rutas.
- Orquestación compleja de navegación durante el tour.
- Dependencia de pasos que requieran abrir modales o flujos multiestado muy frágiles.

## Estructura propuesta

La implementación debe concentrarse en una feature dedicada.

```text
src/
  features/
    tours/
      tourService.ts
      tourRegistry.ts
      tourStorage.ts
      usePageTour.ts
      tour.css
```

Responsabilidades:

- `tourService.ts`: crea, inicia y destruye instancias de `driver.js`; resuelve opciones comunes y comportamiento compartido.
- `tourRegistry.ts`: declara los tours por página y sus pasos.
- `tourStorage.ts`: encapsula llaves y helpers de `localStorage` para recordar tours vistos.
- `usePageTour.ts`: expone una interfaz mínima para la página actual, por ejemplo iniciar el tour o decidir si se muestra automáticamente.
- `tour.css`: contiene el tema visual del tour alineado al estilo de Auna.

## Punto de entrada

El disparador global recomendado vive en el layout principal.

Ubicación sugerida:

- `src/layouts/AppShell.tsx`

Uso recomendado:

- botón de ayuda o icon-only button en el topbar para lanzar el tour de la ruta actual
- resolución del tour activo a partir de la ruta
- sin mover la definición de pasos al layout

El layout solo debe disparar el tour. La definición del contenido y de los pasos no debe repartirse dentro de `AppShell`.

## Definición de targets

Todos los pasos deben apoyarse en selectores estables y explícitos.

Regla principal:

- usar atributos `data-tour` dedicados

Ejemplos:

- `data-tour="dashboard-tabs"`
- `data-tour="expenses-grid"`
- `data-tour="expenses-filters"`
- `data-tour="topbar-help"`

No se debe depender de:

- clases de estilo existentes
- texto visible
- orden implícito de nodos
- selectores frágiles basados en estructura DOM interna de terceros

## Regla especial para grids

En páginas que usan `react-data-grid`, no se deben apuntar celdas individuales salvo necesidad muy justificada.

Se debe preferir:

- contenedor del grid
- toolbar asociada
- filtros
- encabezados estables
- acciones principales alrededor del grid

Se debe evitar:

- celdas virtualizadas
- editores inline efímeros
- elementos que existen solo mientras una celda está activa

Esta regla es especialmente importante para páginas como Egresos, Compras, Ventas, Dividendos y Holdings.

## Guía de contenido

Cada tour debe ser corto.

Reglas recomendadas:

- 4 a 6 pasos por página como objetivo normal
- máximo 8 pasos si hay una razón clara
- una sola idea por paso
- texto corto y directo
- sin párrafos largos

Buenas prácticas para móvil:

- preferir targets grandes o zonas completas
- evitar elementos pegados a bordes cuando exista una alternativa más estable
- reducir texto aún más que en escritorio
- no depender de hover

## Comportamiento recomendado

Cada página puede tener dos formas de inicio:

- manual: desde un botón de ayuda del topbar o acción equivalente
- automático una sola vez: en el primer acceso de la página, si el tour todavía no fue marcado como visto

El inicio automático debe ser conservador:

- esperar a que la UI de la página exista realmente
- no dispararse si faltan los targets mínimos
- no intentar forzar recorridos si la pantalla no terminó de cargar

## Persistencia

El estado de tours vistos debe guardarse en `localStorage` mediante una capa dedicada.

Convenciones sugeridas:

- prefijo común: `auna.tour.`
- una llave por página o por versión del tour

Ejemplos:

- `auna.tour.dashboard.v1`
- `auna.tour.expenses.v1`

Si cambia materialmente el contenido del tour, debe incrementarse la versión de la llave.

## Convención de páginas

Cada página nueva que requiera tour debe seguir este flujo:

1. identificar 3 a 6 zonas realmente importantes de la pantalla
2. agregar `data-tour` solo a esos puntos
3. declarar el tour en `tourRegistry.ts`
4. usar el hook compartido para lanzar el tour
5. validar visualmente escritorio y móvil

## Criterios de calidad

Un tour se considera consistente con esta arquitectura si cumple todo lo siguiente:

- usa `driver.js`
- está definido dentro de `src/features/tours/`
- no incrusta la lógica del tour dentro de la lógica de negocio principal
- usa `data-tour` estables
- evita acoplarse a detalles internos del DOM de terceros
- mantiene texto breve en español
- se revisa al menos en escritorio y móvil

## Primeras pantallas sugeridas

Orden recomendado de implementación:

1. Dashboard
2. Egresos
3. Ingresos
4. Catálogos

Motivo:

- Dashboard es una pantalla de orientación general para usuario nuevo.
- Egresos e Ingresos son flujos de alto valor funcional.
- Catálogos ayuda a entender dependencias de captura.

## Relación con instrucciones de Copilot

La guía completa debe vivir en este documento del repositorio.

Las instrucciones de Copilot deben contener solo un resumen corto y estable de estas reglas para que futuras implementaciones mantengan el patrón sin convertir el archivo de instrucciones en una especificación extensa.