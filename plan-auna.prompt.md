## Plan: Finanzas personales inicial

Se partirá desde cero en el workspace vacío. Para V1, el diseño queda orientado a captura + reportes básicos: flujo de caja, portafolio actual y dividendos cobrados. Se toma MXN como moneda base de reporting, con soporte inicial para MXN y USD. También se fija que “precio dólar” debe modelarse como `fx_rate_to_mxn`. Según lo indicado, `investment_movements` puede ser una sola tabla con `type`, pero las operaciones de acciones se mantendrán separadas en `stock_buys` y `stock_sells` para esta primera versión. Además, se deja preparado `expense_entries` para soportar en una fase futura la estimación de próxima compra a partir de recurrencia e historial.

**Steps**
1. Inicializar la base del proyecto en el root con frontend React 19 + TypeScript y estructura de Supabase. Propuesta de rutas: [package.json](package.json), [src/main.tsx](src/main.tsx), [src/App.tsx](src/App.tsx), [supabase/config.toml](supabase/config.toml), [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql).

2. Definir el modelo de dominio en Supabase separando dos áreas:
   - flujo de caja: `income_entries`, `expense_entries`
   - inversión/mercado: `investment_movements`, `stock_buys`, `stock_sells`, `dividends`
   Además, preparar catálogos administrables para consistencia: `expense_categories`, `income_sources`, `payment_instruments`, `stores`, `brokers`, `investment_entities`. `payment_instruments` representará medios de pago concretos, por ejemplo `Efectivo`, una tarjeta de débito específica o una tarjeta de crédito específica. El soporte de monedas en V1 será fijo para `MXN` y `USD`, sin catálogo editable.

3. Diseñar todas las tablas financieras con trazabilidad monetaria mínima:
   - `currency_code`
   - `fx_rate_to_mxn`
   - importes originales
   - importes normalizados a MXN
   Así se evita recalcular históricos con tipos de cambio futuros y se mantiene auditoría contable.

4. Modelar `income_entries` con los campos: `date`, `source`, `currency_code`, `amount_original`, `fx_rate_to_mxn`, `amount_mxn`, `notes`, `user_id`.

5. Modelar `expense_entries` con: `date`, `concept`, `quantity`, `unit_of_measure`, `unit_cost_original`, `total_amount_original`, `currency_code`, `fx_rate_to_mxn`, `total_amount_mxn`, `payment_instrument_id`, `store_id`, `ticket_url` o `ticket_path`, `is_recurring`, `category` (`essential`/`non_essential`), `notes`, `user_id`. El ticket debe quedar como archivo referenciado en Storage, no embebido en tabla. Aunque la predicción de próxima compra no entra en V1, estos campos ayudan a clasificar gastos y a dejar mejor base para esa capacidad, especialmente porque `quantity` y `unit_of_measure` permitirán después estimar consumo y reposición con más precisión.

6. Modelar `investment_movements` como ledger simple para movimientos no bursátiles con `type` = `income`/`expense`, más `entity`, `date`, `amount_original`, `currency_code`, `fx_rate_to_mxn`, `amount_mxn`, `notes`, `user_id`. Esto cubre aportaciones o retiros de inversión sin mezclarlo con compra/venta de acciones.

7. Mantener `stock_buys` y `stock_sells` separadas en V1, con campos paralelos: `ticker`, `trade_date`, `quantity`, `currency_code`, `unit_price_original`, `gross_amount_original`, `commission_original`, `fx_rate_to_mxn`, `gross_amount_mxn`, `commission_mxn`, `broker_id`, `user_id`. Esto respeta la preferencia funcional actual y simplifica formularios.

8. Modelar `dividends` con `ticker`, `payment_date`, `currency_code`, `subtotal_original`, `withholding_original`, `total_original`, `fx_rate_to_mxn`, `subtotal_mxn`, `withholding_mxn`, `total_mxn`, `broker_id`, `user_id`. Aquí no usar `precio_unitario`; para dividendos importa el cobro total y sus descuentos.

9. Crear vistas de lectura para reportes básicos en Supabase:
   - `cashflow_monthly_summary`
   - `portfolio_positions`
   - `dividends_summary`
   La vista de portafolio actual puede calcular posiciones por `ticker` a partir de compras y ventas, sin entrar todavía en ganancia/pérdida realizada.

10. Definir seguridad desde el inicio con `user_id` en todas las tablas y políticas RLS por propietario. La autenticación puede quedar preparada aunque en V1 la UI sea simple.

11. Estructurar frontend por features para no mezclar dominios. Propuesta:
   - [src/features/income](src/features/income)
   - [src/features/expenses](src/features/expenses)
   - [src/features/investments](src/features/investments)
   - [src/features/stocks](src/features/stocks)
   - [src/features/dividends](src/features/dividends)
   - [src/lib/supabase](src/lib/supabase)
   - [src/pages](src/pages)
   La navegación principal de V1 será mediante menú lateral, no con pestañas superiores.

12. Diseñar la UX de V1 con enfoque `table-first`, buscando una experiencia cercana a Excel para captura rápida. Cada dominio tendrá una pantalla con tabla editable para:
   - ingresos
   - egresos
   - movimientos de inversión
   - compra de acción
   - venta de acción
   - dividendo
   Además, habrá un dashboard simple con tarjetas y tablas para flujo de caja, posiciones actuales y dividendos.

13. Definir el comportamiento de las tablas editables de V1 para que la captura sea ágil:
   - mostrar una fila vacía al inicio para captura inmediata, manteniendo visibles primero los movimientos más recientes debajo
   - edición inline por celda
   - autoguardado por fila
   - eliminar registros sin salir de la vista, con confirmación explícita
   - navegación con teclado (`Tab`, `Enter`, flechas)
   - validación visual inmediata en cada fila
   - filtros y ordenamiento básicos
   - catálogos rápidos para moneda, categoría, forma de pago y tienda
   - orden por defecto con fecha descendente en los registros ya guardados
   - columnas congeladas al menos para `date` y `concept`/`ticker`, según el dominio
   - ancho de columnas automático, pero ajustable por el usuario

14. Complementar la tabla con un panel lateral o `drawer` para detalle del registro y acciones secundarias, pero sin mover campos fuera de la grilla en V1. Por ahora, la captura y edición principal debe resolverse completamente en la tabla; más adelante se evaluará si algunos campos conviene pasarlos al `drawer`.

15. Definir estados visuales de fila para reforzar la sensación de hoja de cálculo sin perder claridad:
   - fila nueva: inputs con apariencia claramente editable
   - fila guardada: inputs sin bordes visibles o con estilo neutro, para no aparentar edición activa
   - fila con error: apariencia editable con borde rojo tenue y resumen de validación a nivel fila

16. Incluir pantallas de administración de catálogos cerrados pero editables por el usuario. En V1 existirán al menos estos catálogos: `expense_categories`, `income_sources`, `payment_instruments`, `stores`, `brokers`, `investment_entities`. Estos catálogos deben poder consultarse, agregarse, editarse y desactivarse desde tablas similares al resto de la aplicación. Los catálogos serán distintos por dominio cuando aplique, por ejemplo `expense_categories` separada de otras clasificaciones funcionales.

17. Definir campos mínimos estándar para las tablas de catálogo en V1:
   - `name`
   - `description`
   - `is_active`
   - `notes`
   Además, no se permitirán nombres duplicados dentro del mismo catálogo. `payment_instruments` requerirá además al menos un campo `instrument_type` con valores como `cash`, `debit_card` y `credit_card`; opcionalmente podrá crecer después con datos como emisor o últimos 4 dígitos.

18. Definir la vista inicial de cada módulo mostrando solo el mes actual por defecto, con opciones rápidas para cambiar a un rango personalizado cuando sea necesario.

19. Seleccionar una librería de grilla gratuita y madura para soportar la UX tipo Excel. La candidata principal para V1 será `react-data-grid`, por su soporte de React 19, edición por celda, navegación por teclado, copy/paste, virtualización y alto nivel de personalización visual. Como alternativas quedan `AG Grid Community` y `Glide Data Grid`, según la complejidad real que tome la implementación.

20. Incluir acciones rápidas por fila visibles en la tabla para acelerar el flujo operativo:
   - duplicar registro
   - eliminar registro
   - abrir detalle del registro
   El duplicado debe copiar el registro tal cual.

21. Mostrar resúmenes visibles arriba de cada tabla, incluyendo totales principales y subtotales dependientes de los filtros o del rango aplicado. En `expense_entries`, los resúmenes iniciales de V1 serán `total_mxn` y total por `category`. En el resto de módulos no habrá KPIs adicionales por ahora.

22. Definir una matriz inicial de columnas visibles por módulo para V1:
   - `income_entries`: `date`, `source`, `currency_code`, `amount_original`, `fx_rate_to_mxn`, `amount_mxn`
   - `expense_entries`: `date`, `concept`, `quantity`, `unit_of_measure`, `category`, `total_amount_mxn`
   - `stock_buys` y `stock_sells`: `ticker`, `trade_date`, `quantity`, `currency_code`, `unit_price_original`, `commission_original`
   - `investment_movements`: todas visibles
   - `dividends`: todas visibles

23. Definir columnas congeladas iniciales por módulo:
   - `income_entries`: congelar `date` y `source`
   - `expense_entries`: congelar `date` y `concept`
   - `stock_buys` y `stock_sells`: congelar `ticker` y `trade_date`
   - `investment_movements`: sin columnas congeladas por ahora
   - `dividends`: sin columnas congeladas por ahora

24. Definir tipos de editor iniciales para V1:
   - fechas (`date`, `trade_date`, `payment_date`): captura por texto con parseo rápido y opción de `date picker`
   - catálogos (`currency_code`, `category`, `payment_instrument`, `store`, `broker`, `source`, `entity`): `select` buscable sobre listas cerradas
   - numéricos (`amount_original`, `amount_mxn`, `total_amount_mxn`, `quantity`, `unit_price_original`, `commission_original`, `fx_rate_to_mxn`): editor numérico sin formato visual intrusivo, para permitir precisión decimal
   - booleanos como `is_recurring`: `checkbox` o `toggle` inline
   - texto corto (`concept`, `ticker`, `unit_of_measure`): texto inline

25. Definir reglas generales de validación de V1 con criterio de captura rápida:
   - exigir solo campos mínimos por tabla
   - permitir que `notes` y `ticket` sean opcionales
   - autocompletar `fx_rate_to_mxn` cuando sea posible, pero mantenerlo editable por el usuario
   - mostrar errores en resumen por fila, sin bloquear innecesariamente la captura de campos opcionales

26. Definir obligatorios mínimos por tabla para permitir guardar en V1:
   - `income_entries`: `date`, `source`, `currency_code`, `amount_original`
   - `expense_entries`: `date`, `concept`, `quantity`, `unit_of_measure`, `category`, `total_amount_mxn`
   - `investment_movements`: `date`, `entity`, `type`, `currency_code`, `amount_original`
   - `stock_buys`: todos los campos del módulo
   - `stock_sells`: todos los campos del módulo
   - `dividends`: todos los campos del módulo

27. Estandarizar nombres de campos para evitar ambigüedad:
   - usar `fx_rate_to_mxn` en vez de “precio dólar”
   - usar `unit_price_original` para precio unitario en moneda original
   - usar `amount_mxn` o `total_mxn` para montos normalizados
   Esto deja el modelo claro para consultas y UI.

28. Posponer para después de V1:
   - multimoneda más allá de MXN/USD
   - ganancia/pérdida realizada
   - método de costo (`FIFO`, promedio, etc.)
   - importador de texto plano a registros, para pegar contenido desde Excel en formato CSV o TSV, indicando qué columnas vienen presentes y cuáles no antes de confirmar la importación
   - fiscalidad avanzada de dividendos y ventas
   - gestión detallada de tarjetas de crédito, incluyendo catálogo `credit_cards` con `name`, `bank`, `last_four`, `statement_day`, `due_day` y `credit_limit`
   - registro de `credit_card_payments` o abonos con `date`, `credit_card_id`, `amount` y `notes`
   - vista futura de deuda o seguimiento de tarjeta, sin contar los abonos como gasto nuevo
   - estimación de próxima fecha de compra a partir del historial de `expense_entries`, usando la última frecuencia observada ajustada por `quantity` y `unit_of_measure`; por ejemplo, si una compra fue de 10 piezas y la siguiente de 5 piezas, el sistema debería inferir una reposición esperada más próxima que la observada entre ambas fechas

**Verification**
- Validar altas manuales de cada tipo de registro con persistencia correcta en Supabase.
- Confirmar que cada captura guarda moneda original, tipo de cambio y monto en MXN.
- Confirmar que la captura principal puede hacerse desde tablas editables sin depender de formularios largos o modales.
- Verificar navegación fluida con teclado para agregar y editar filas.
- Confirmar que cada tabla muestre por defecto el mes actual y permita cambiar a rango personalizado.
- Verificar que los catálogos editables por usuario se puedan administrar sin salir del flujo principal.
- Verificar que los estados visuales de fila comuniquen bien si el registro es nuevo, guardado o inválido.
- Validar que la librería de grilla elegida soporte bien edición inline, estilos por estado y rendimiento suficiente para el volumen esperado.
- Confirmar que todas las columnas operativas necesarias estén en la grilla principal sin depender del `drawer`.
- Verificar que los totales y subtotales reaccionen correctamente a filtros y rangos.
- Verificar que las columnas congeladas mantengan contexto durante el scroll horizontal.
- Confirmar que el usuario pueda ajustar anchos de columna sin romper la legibilidad de la tabla.
- Confirmar que la matriz inicial de columnas visibles por módulo cubra la captura diaria sin saturar la grilla.
- Validar que los editores elegidos permitan captura rápida sin sacrificar precisión, especialmente en fechas, decimales y `fx_rate_to_mxn`.
- Confirmar que las reglas mínimas de obligatoriedad no bloqueen el flujo operativo principal.
- Verificar que los obligatorios mínimos por tabla sean consistentes con el autoguardado por fila.
- Verificar que los catálogos de V1 permitan alta, edición, desactivación y control de duplicados por nombre.
- Confirmar que `payment_instruments` cubra correctamente efectivo y tarjetas concretas sin mezclar conceptos de tipo y cuenta.
- Confirmar que `MXN` y `USD` cubran las necesidades iniciales sin requerir catálogo de monedas editable.
- En la fase futura de tarjetas de crédito, verificar que los abonos reduzcan deuda sin duplicar gasto en reportes.
- Confirmar que una compra con tarjeta de crédito quede ligada a la tarjeta, pero sin generar doble registro de gasto.
- Revisar que el dashboard muestre:
  - flujo de caja por periodo
  - posiciones actuales por `ticker`
  - dividendos cobrados acumulados
- Verificar RLS creando y leyendo datos solo del usuario autenticado.

**Decisions**
- Monedas V1: MXN y USD.
- Moneda base de reporting: MXN.
- “Precio dólar” se redefine como `fx_rate_to_mxn`.
- `investment_movements` será una sola tabla con `type`.
- `stock_buys` y `stock_sells` se mantienen separadas en V1.
- `expense_entries` incluirá `is_recurring` y `category` desde V1.
- La futura predicción de recompra en gastos se basará en frecuencia observada más consumo implícito según `quantity` y `unit_of_measure`.
- La UX principal de V1 será tipo Excel: tablas editables, captura inline, menú lateral de navegación y panel lateral solo para detalles.
- El guardado en tablas será por autoguardado al nivel de fila.
- La captura iniciará con una fila vacía al inicio y mostrará por defecto los registros del mes actual.
- El borrado de registros requerirá confirmación.
- Los catálogos serán listas cerradas pero administrables por el usuario desde sus propias tablas.
- Los catálogos funcionales serán distintos por dominio.
- Los catálogos iniciales de V1 serán `expense_categories`, `income_sources`, `payment_instruments`, `stores`, `brokers` e `investment_entities`.
- Los catálogos compartirán campos mínimos `name`, `description`, `is_active` y `notes`.
- `payment_instruments` agregará al menos `instrument_type` para distinguir `cash`, `debit_card` y `credit_card`.
- No se permitirán duplicados de `name` dentro del mismo catálogo.
- Las filas tendrán estados visuales distintos para nuevo, guardado y error.
- La opción técnica preferida para la grilla editable de V1 será `react-data-grid`.
- En V1 no se moverán campos al `drawer`; toda la captura operativa vivirá en la tabla.
- Las acciones rápidas por fila serán `duplicar`, `eliminar` y `abrir detalle`.
- El duplicado copiará el registro tal cual.
- La validación visible de errores será con resumen por fila.
- Cada tabla mostrará totales principales arriba y subtotales según filtros; en gastos, al menos `total_mxn` y total por `category`.
- Habrá columnas congeladas por dominio y anchos automáticos ajustables por el usuario.
- La matriz inicial de columnas visibles será específica por módulo.
- `investment_movements` y `dividends` mostrarán todas sus columnas en V1 y no tendrán columnas congeladas por defecto.
- Las fechas usarán texto con parseo rápido y también `date picker`.
- Los catálogos usarán `select` buscable.
- Los numéricos se editarán como número sin formato visual agresivo para no estorbar decimales.
- La obligatoriedad en V1 será mínima por tabla; `notes` y `ticket` serán opcionales.
- `fx_rate_to_mxn` se autocompletará cuando sea posible, pero seguirá siendo editable.
- Los obligatorios mínimos ya quedan definidos por módulo; en compras, ventas y dividendos se requerirán todos sus campos en V1.
- El campo antes pensado como `payment_method` pasa a modelarse como `payment_instrument`, porque el usuario captura medios concretos como efectivo y tarjetas específicas.
- Los abonos a tarjeta de crédito deberán modelarse como un flujo separado para no duplicar el gasto original; se contemplan para una siguiente fase.
- A futuro, las compras con tarjeta de crédito solo se ligarán a la tarjeta usada; los abonos no se reflejarán como gasto nuevo en reportes.
- El catálogo futuro de tarjetas de crédito incluirá al menos nombre, banco, últimos 4, fecha de corte, fecha límite de pago y límite de crédito.
- Los abonos futuros a tarjeta capturarán al menos fecha, tarjeta, monto y notas.
- Las monedas de V1 serán fijas: `MXN` y `USD`, sin catálogo editable.
- La importación desde Excel no entra en el primer corte de V1; después se evaluará un importador por pegado de CSV/TSV con mapeo de columnas.
- Reportería V1: básica; sin rendimiento realizado/no realizado.
