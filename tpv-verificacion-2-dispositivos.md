# Guion de verificación — Sync de sesiones y comandas con 2 dispositivos

> Objetivo: validar de punta a punta el sync de **sesiones** y **comandas** entre dos TPV
> reales contra el backend **de pruebas (Laragon)**, y —lo más importante— confirmar que
> **no se pierde ningún dato** existente en la transición.
>
> **Hazlo SIEMPRE contra Laragon primero (modo 'local'), NUNCA contra producción.**
> Cuando todo pase, se repite apuntando a producción tras desplegar las migraciones 031 y 032.

Leyenda: 🅰 = dispositivo A · 🅱 = dispositivo B · ✅ = resultado esperado · 🔎 = cómo comprobarlo en BD.

---

## 0. Preparación (una vez)

- [ ] **PC (Laragon)** encendido con Apache + MySQL. La BD `burger_beats_local` ya tiene las
      migraciones **031** (sesiones) y **032** (tickets) aplicadas.
- [ ] Los dos móviles y el PC en la **misma red WiFi**.
- [ ] En cada móvil: **Ajustes → Servidor → modo "local"**, con la **IP del PC** correcta
      (ver `scripts/actualizar-ip.bat` / el doc de acceso LAN si cambió la IP).
- [ ] Comprueba conexión: en cada móvil **Ajustes → Sincronizar ahora** debe responder sin
      error de red (aunque no haya nada que sincronizar).
- [ ] **Ajustes → Impresión → "Letra del dispositivo"**: pon **A** en 🅰 y **B** en 🅱
      (identificador interno; NO se imprime).
- [ ] Ten a mano una forma de mirar la BD: **HeidiSQL** (viene con Laragon) sobre
      `burger_beats_local`. Las consultas 🔎 de este guion se pegan ahí.

> **Reset entre pruebas (opcional):** si quieres partir de cero en el backend sin tocar los
> móviles, borra los datos de prueba con las consultas del Apéndice B. Nunca borres nada en
> los móviles.

---

## 1. Seguridad de la migración (LO MÁS IMPORTANTE)

Esta parte solo aplica si el móvil venía de una versión **anterior** a esta (esquema < v27).
Si ya instalaste esta versión, los datos ya están migrados: salta al punto 1.4 y confirma
que el historial sigue completo.

1.1. [ ] **ANTES de instalar** la nueva versión, en cada móvil anota en papel:
   - Nº de sesiones en el historial: 🅰 ____ · 🅱 ____
   - Nº de tickets de la última sesión: 🅰 ____ · 🅱 ____
   - ¿Hay sesión activa? cuál: 🅰 ____ · 🅱 ____

1.2. [ ] Instala la nueva versión **SIN desinstalar** (encima de la anterior, para que corran
     las migraciones locales v26/v27 sobre los datos existentes).

1.3. [ ] Abre la app y espera a que cargue.

1.4. ✅ **Comprobaciones (deben coincidir con lo anotado):**
   - [ ] El historial muestra **exactamente el mismo nº de sesiones** que antes.
   - [ ] La sesión activa se recupera igual (o no hay, si no había).
   - [ ] Al abrir una sesión antigua, sus **tickets siguen intactos** (mismo nº y totales).
   - [ ] No aparece ninguna sesión "fantasma" ni desaparece ninguna.

> Si algo no coincide, **para aquí** y no sigas: es el único punto que puede perder datos.

---

## 2. Sync básico de sesiones (push + pull)

2.1. [ ] En 🅰: abre una sesión nueva (elige un local, "Abrir la mía" si pregunta).
2.2. [ ] En 🅰: **Sincronizar ahora**. ✅ La línea "Sesiones" dice "1 enviada" (o más).
   - 🔎 `SELECT id, status, device_id FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5;` → aparece la sesión de 🅰.
2.3. [ ] En 🅱: **Sincronizar ahora**. ✅ "Sesiones … recibida(s)".
2.4. [ ] En 🅱: la sesión de 🅰 **no** aparece como activa (🅱 sigue sin jornada propia). ✅
2.5. [ ] En 🅰: cierra la sesión. **Sincronizar**. En 🅱: **Sincronizar**.
   - [ ] ✅ En 🅱 → **Historial de sesiones**: aparece la sesión cerrada de 🅰 (marcada como
         de otro dispositivo). 🔎 su `status='closed'` en BD.

---

## 3. CRUD de sesiones sincronizado

3.1. **Editar notas/ubicación/precios**
   - [ ] En 🅱: abre esa sesión (la de 🅰) → **Editar sesión** → añade una nota → Guardar.
   - [ ] En 🅱: **Sincronizar**. En 🅰: **Sincronizar** → abre la sesión.
   - [ ] ✅ La nota escrita en 🅱 aparece en 🅰. (Sesiones compartidas y **editables** entre
         dispositivos — decisión acordada.)
   - 🔎 `SELECT id, notes, updated_at FROM sessions WHERE id='<id>';`

3.2. **Borrado (soft delete)**
   - [ ] En 🅰: **Editar sesión → Borrar sesión** (si tiene tickets, confirma el diálogo
         reforzado). 
   - [ ] En 🅰: **Sincronizar**. En 🅱: **Sincronizar**.
   - [ ] ✅ La sesión desaparece del historial en **ambos** móviles.
   - 🔎 `SELECT id, deleted_at FROM sessions WHERE id='<id>';` → `deleted_at` NO es NULL, y la
         fila **sigue existiendo** (no se borró físicamente); sus tickets tampoco se borraron.

---

## 4. Totales combinados de comandas (el objetivo)

4.1. [ ] En 🅰: abre una sesión. Haz **2 comandas** con importes distintos (imprime o usa el
     toggle "no imprimir"). Anota el total de 🅰: ____
4.2. [ ] En 🅱: **únete** a esa sesión (ver punto 5) **o**, si prefieres probar sin compartir,
     salta a 4.5.
4.3. [ ] En 🅱 (unido a la sesión de 🅰): haz **1 comanda**. Anota su importe: ____
4.4. [ ] **Sincroniza en los dos** (🅰 y 🅱).
   - [ ] ✅ El **resumen de la sesión** (Ver resumen) muestra el **total combinado**
         (2 comandas de 🅰 + 1 de 🅱) en **ambos** móviles.
   - 🔎 `SELECT COALESCE(SUM(total),0) FROM orders WHERE session_id='<id>';` = suma de las 3.
4.5. **Idempotencia:** [ ] pulsa **Sincronizar** otra vez en 🅰 sin hacer nada nuevo.
   - [ ] ✅ "Comandas: 0 enviadas" (o sin cambios). No se duplica nada.
   - 🔎 el nº de filas en `tickets`/`orders` de la sesión **no cambia**.

4.6. **Numeración sin colisión:** [ ] con 🅰 y 🅱 sobre la misma sesión, comprueba que la
     comanda impresa de cada uno lleva **"#N"** y que el número **no se pisa** entre
     dispositivos (cada móvil numera su serie).
   - Nota: en el papel impreso sale "#3" (la letra A/B NO se imprime, es interna).

---

## 5. Compartir al abrir (Fase 5)

5.1. [ ] Con una sesión **abierta en 🅰** (y sincronizada), en 🅱 pulsa **"Abrir sesión"**.
   - [ ] ✅ Aparece el diálogo **"Ya hay una jornada abierta"** con la sesión de 🅰
         (nombre de local, hora, "Disp. …").
5.2. **Unirse:** [ ] pulsa **"Unirse"** en la sesión de 🅰.
   - [ ] ✅ 🅱 entra en esa sesión como activa; las comandas que haga 🅱 caen en la misma
         jornada (verifícalo con el punto 4).
5.3. **Abrir la propia:** [ ] repite 5.1 y pulsa **"Abrir la mía"**.
   - [ ] ✅ 🅱 abre su propia sesión distinta (diálogo de precios normal).
5.4. **Sin conexión:** [ ] apaga el WiFi de 🅱 y pulsa "Abrir sesión".
   - [ ] ✅ 🅱 abre su **propia** sesión sin preguntar (no puede consultar). Al volver la red
         y sincronizar, ambas sesiones conviven y son **unificables** (punto 6).

---

## 6. Unificar sesiones (Fase 6)

Precondición: dos sesiones **cerradas** con tickets (p. ej. la propia de 🅱 del punto 5.4 y
otra). Se hace en **un** dispositivo.

6.1. [ ] Cierra ambas sesiones a fusionar. Sincroniza.
6.2. [ ] Abre el **detalle** de la sesión que quieres **conservar** → botón **"Fusionar"**.
6.3. [ ] Elige la sesión a **absorber** en la lista → confirma.
   - [ ] ✅ Los tickets de la absorbida aparecen ahora en la superviviente, **renumerados** a
         continuación. La absorbida **desaparece** del historial.
6.4. [ ] **Sincroniza** en este móvil y luego en el otro.
   - [ ] ✅ En el otro dispositivo, tras sincronizar, la superviviente muestra **todos** los
         tickets y el **total sumado**; la absorbida ya no aparece.
   - 🔎 `SELECT session_id, ticket_number FROM tickets WHERE id='<id_ticket_movido>';` → su
         `session_id` es ahora el de la superviviente. 🔎 `deleted_at` de la absorbida no es NULL.

---

## 7. Reglas de conflicto

7.1. **`closed` es terminal:** [ ] cierra una sesión en 🅰 y sincroniza; en 🅱 (que aún la
     tenía abierta en su copia) intenta reabrir/editar y sincroniza.
   - [ ] ✅ La sesión **no se reabre**: gana el cierre. No hay "resurrección" de la jornada.
7.2. **Última escritura gana (notas):** [ ] edita la nota de una misma sesión en 🅰 y luego,
     más tarde, en 🅱. Sincroniza ambos.
   - [ ] ✅ Prevalece la edición **más reciente** (la de 🅱).

---

## Resultado

- [ ] **Todos los bloques 1–7 en verde** contra Laragon.
- [ ] Solo entonces: desplegar migraciones **031** y **032** a producción y repetir los
      bloques 2, 4 y 6 apuntando a producción (modo "production" en Ajustes → Servidor).

---

## Apéndice A — Comportamientos ESPERADOS (no son fallos)

- Una sesión **abierta** de otro dispositivo **no** aparece en el *Historial* (que solo lista
  cerradas); sí aparece en el diálogo **al abrir** (punto 5). Cuando se cierra, ya entra en el
  historial.
- Las comandas de **otro** dispositivo se ven con **"#N"** en la app (la letra A/B es local a
  cada móvil, no viaja). En el papel impreso **nunca** aparece la letra.
- Al **unirse** a una sesión de un local que este móvil no tenga sincronizado, el nombre del
  local puede salir como un id hasta que sincronices **Ubicaciones**.
- El indicador de la marca "para llevar" es local al momento de venta y puede no reflejarse en
  una comanda vista desde otro dispositivo.

## Apéndice B — Consultas útiles (HeidiSQL sobre `burger_beats_local`)

```sql
-- Sesiones visibles y su estado
SELECT id, session_code, status, device_id, updated_at, deleted_at
  FROM sessions ORDER BY created_at DESC LIMIT 20;

-- Comandas de una sesión con su total
SELECT t.id, t.ticket_number, t.device_id, t.edit_count,
       (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.ticket_id = t.id) AS total
  FROM tickets t WHERE t.session_id = '<ID_SESION>' ORDER BY t.ticket_number;

-- Total combinado de una sesión (todos los dispositivos)
SELECT COALESCE(SUM(total),0) FROM orders WHERE session_id = '<ID_SESION>';

-- Reset de datos de PRUEBA de una sesión concreta (NO tocar datos reales)
DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.session_id = '<ID>';
DELETE FROM orders  WHERE session_id = '<ID>';
DELETE FROM tickets WHERE session_id = '<ID>';
DELETE FROM sessions WHERE id = '<ID>';
```

## Apéndice C — Cómo forzar el sync

- **Ajustes → "Sincronizar ahora"**: ejecuta TODO (precios, productos, locales, **sesiones**,
  **comandas**) en orden. Es el botón que se usa en todo este guion.
- El botón separado "Sincronizar cola de tickets" es del sistema **antiguo** (`sync.ts`, en
  stub): no se usa para esta verificación.
