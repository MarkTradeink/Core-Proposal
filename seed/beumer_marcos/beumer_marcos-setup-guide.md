# beumer_marcos — configuración de propuestas

> Generado desde la hoja **Proposal Config** de este cliente con `node scripts/client-docs.js beumer_marcos`.
> No lo edites a mano: edita la hoja y vuelve a generarlo, o dejará de reflejar la realidad.

## Qué produce este cliente

- **Idioma por defecto:** es
- **Peso del documento por defecto:** B — propuesta estándar (15-25 pág.)
- **Versión del documento:** 1.0
- **Capítulos configurados:** 16
- **Cláusulas propias:** 60

## Variables propias de este cliente

Estas son las etiquetas que **puedes usar en la plantilla `.docx`**. Cualquier otra `{campos.*}` imprimirá la palabra `undefined` en el documento del cliente.

| Etiqueta en la plantilla | De dónde sale | Obligatorio |
|---|---|---|
| `{campos.n_oferta}` | del correo, buscando `Oferta nº` o `Offer no` o `Oferta no` | sí |
| `{campos.version_doc}` | del correo, buscando `Versión` o `Version` | no |
| `{campos.atencion}` | del correo, buscando `Att.` o `Attn` o `Atn.` | no |
| `{campos.n_activo}` | del correo, buscando `Asset` o `Activo` | no |
| `{campos.n_proyecto}` | del correo, buscando `Project number` o `Nº proyecto` | no |
| `{campos.razon_social}` | valor fijo en la hoja: `BEUMER Group Technology Iberia S.L.` | sí |
| `{campos.copyright}` | valor fijo en la hoja: `© BEUMER Group 2026` | no |

> Un campo obligatorio que no venga en el correo **detiene la propuesta** y la marca para revisión, en lugar de emitir una portada con un hueco.

## Plantillas

La pestaña `Templates` está vacía, así que se usan los ids `template_id_es` / `template_id_en` de la ficha de Notion.

## Capítulos

Los que salen hoy, en orden, con todo el alcance activado:

— Portada
— Control de versión
— Contenido
**1.** Bases de la oferta
  - 1.1 Documentos y reuniones de referencia
**2.** Introducción
  - 2.1 Descripción del sistema
  - 2.2 Situación actual y obsolescencia
  - 2.3 Objetivo de la actuación
**3.** Alcance de suministro
  - 3.1 Resumen del alcance
  - 3.2 Hardware
  - 3.3 Software
  - 3.4 Recambios
  - 3.5 Documentación
**4.** Ejecución de los trabajos
  - 4.1 Instalación
  - 4.2 Puesta en marcha
  - 4.3 Plan de pruebas
  - 4.4 Envío
  - 4.5 Aceptación de los trabajos
**5.** Recurso preventivo (QHSE)
**6.** Soporte a la operativa
**7.** Gestión de proyecto
  - 7.1 Coordinación de las actuaciones
  - 7.2 Planificación detallada
**8.** Condiciones técnicas
  - 8.1 Condiciones de instalación
  - 8.2 Ventanas de intervención y turnos de trabajo
  - 8.3 Acceso a las instalaciones y seguridad
  - 8.4 Suministros necesarios
  - 8.5 Entregables por el Cliente
  - 8.6 Condiciones de operación y disponibilidad del sistema
**9.** Exclusiones y consideraciones adicionales
  - 9.1 Supuestos y dependencias
  - 9.2 Exclusiones
  - 9.3 Gestión de desviaciones y órdenes de cambio
**10.** Términos y condiciones comerciales
  - 10.1 Precio
  - 10.2 Opciones
  - 10.3 Conceptos no incluidos en el precio
  - 10.4 Condiciones de pago
  - 10.5 Moneda
  - 10.6 Indexación y revisión de precios
  - 10.7 Validez
  - 10.8 Plazo de entrega
**11.** Garantía
  - 11.1 Periodo de garantía
  - 11.2 Exclusiones de la garantía
**12.** Condiciones generales y reservas
  - 12.1 Condiciones generales de contratación
**13.** Cierre

## Estilo de redacción

Estas líneas se inyectan literalmente en las instrucciones de los agentes que escriben:

- `default_tier`: B
- `tone`: técnico, sobrio y factual; frases cortas; sin superlativos ni lenguaje comercial
- `person`: tercera persona nombrando a BEUMER y al Cliente (BEUMER propone, el Cliente facilitará)
- `units`: Sistema Internacional; decimal con coma en español
- `date_format`: dd/mm/aaaa
- `forbidden_words`: revolucionario, líder mundial, llave en mano definitiva, best-in-class, sinergia, innovador, puntero, óptimo
- `must_mention`: continuidad de la operación, obsolescencia de los equipos, minimizar el impacto en la producción
- `warranty_months`: 24
- `validity_days`: 90
- `incoterm`: DAP
- di **el Cliente**, nunca "cliente final"
- di **equipo**, nunca "máquina"
- di **BEUMER**, nunca "nosotros"
- di **el Cliente**, nunca "usuario"

