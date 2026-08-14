# demo_client — configuración de propuestas

> Generado desde la hoja **Proposal Config** de este cliente con `node scripts/client-docs.js demo_client`.
> No lo edites a mano: edita la hoja y vuelve a generarlo, o dejará de reflejar la realidad.

## Qué produce este cliente

- **Idioma por defecto:** es
- **Peso del documento por defecto:** B — propuesta estándar (15-25 pág.)
- **Versión del documento:** 1.0
- **Capítulos configurados:** 16
- **Cláusulas propias:** 34

## Variables propias de este cliente

Estas son las etiquetas que **puedes usar en la plantilla `.docx`**. Cualquier otra `{campos.*}` imprimirá la palabra `undefined` en el documento del cliente.

| Etiqueta en la plantilla | De dónde sale | Obligatorio |
|---|---|---|
| `{campos.n_oferta}` | del correo, buscando `Oferta nº` o `Offer no` | no |
| `{campos.n_activo}` | del correo, buscando `Asset` o `Activo` | no |
| `{campos.n_proyecto}` | del correo, buscando `Project number` o `Nº proyecto` | no |
| `{campos.atencion}` | del correo, buscando `Att.` o `Atn.` o `Attn` | no |
| `{campos.razon_social}` | valor fijo en la hoja: `(vacío)` | no |
| `{campos.n_documento}` | automático: el número de propuesta que genera Cifral | no |

## Plantillas

La pestaña `Templates` está vacía, así que se usan los ids `template_id_es` / `template_id_en` de la ficha de Notion.

## Capítulos

Los que salen hoy, en orden, con todo el alcance activado:

— Portada
— Control de versión
— Índice
**1.** Resumen ejecutivo
  - 1.1 La necesidad
  - 1.2 La solución propuesta
  - 1.3 Beneficios e indicadores
  - 1.4 Resumen económico y plazo
**2.** Bases de la oferta
  - 2.1 Documentos de referencia
  - 2.2 Normativa y estándares aplicables
  - 2.3 Premisas generales
**3.** Antecedentes y situación actual
  - 3.1 Instalación existente
  - 3.2 Problemática y obsolescencia
  - 3.3 Objetivos y criterios de éxito
**4.** Alcance de suministro
  - 4.1 Resumen de lo incluido y no incluido
  - 4.2 Software y licencias
  - 4.3 SCADA / HMI y visualización
  - 4.4 Documentación técnica entregable
**5.** Ejecución del proyecto
  - 5.1 Inspección previa y toma de datos
  - 5.2 Fases de ejecución
  - 5.3 Plan de pruebas y criterios de aceptación
  - 5.4 Periodo de demostración
  - 5.5 Recepción y aceptación
**6.** Gestión de proyecto
  - 6.1 Metodología y control del proyecto
  - 6.2 Comunicación y reporting
  - 6.3 Gestión de cambios
  - 6.4 Planificación, hitos y plazo
**7.** Continuidad operativa, seguridad y riesgos
  - 7.1 Estrategia de continuidad operativa
  - 7.2 Contingencia y reversión
  - 7.3 Registro de riesgos
  - 7.4 Seguridad y salud
**8.** Condiciones técnicas y requisitos del emplazamiento
  - 8.1 Área de trabajo y accesibilidad
  - 8.2 Jornadas de trabajo y disponibilidad del sistema
  - 8.3 Accesos, permisos y acreditaciones
  - 8.4 Suministros a cargo del cliente
  - 8.5 Obligaciones del cliente
**9.** Límites del alcance
  - 9.1 Premisas e hipótesis
  - 9.2 Exclusiones
  - 9.3 Interfaces y límites de suministro
  - 9.4 Condiciones que originan una orden de cambio
**10.** Oferta económica
  - 10.1 Resumen de precios
  - 10.2 Opciones cotizadas aparte
  - 10.3 Tarifas para trabajos adicionales
  - 10.4 Conceptos no incluidos en el precio
  - 10.5 Condiciones de pago
  - 10.6 Moneda
  - 10.7 Validez de la oferta
  - 10.8 Plazo de entrega
**11.** Garantía y soporte post-venta
  - 11.1 Exclusiones de la garantía
  - 11.2 Soporte técnico y niveles de servicio
  - 11.3 Servicios recurrentes recomendados
**12.** Condiciones generales y reservas
  - 12.1 Marco contractual
  - 12.2 Responsabilidad y limitaciones
  - 12.3 Propiedad intelectual
  - 12.4 Confidencialidad
**13.** Próximos pasos y aceptación

## Estilo de redacción

Estas líneas se inyectan literalmente en las instrucciones de los agentes que escriben:

- `default_tier`: B
- `tone`: técnico, sobrio y concreto; sin superlativos ni lenguaje comercial
- `person`: primera persona del plural (proponemos, ejecutaremos)
- `units`: Sistema Internacional; decimal con coma en español
- `date_format`: dd/mm/aaaa
- `forbidden_words`: revolucionario, líder mundial, solución llave en mano definitiva, best-in-class, sinergia
- `must_mention`: continuidad de la operación, trazabilidad documental
- `warranty_months`: 24
- `validity_days`: 30
- `incoterm`: DAP
- di **el Cliente**, nunca "cliente final"
- di **equipo**, nunca "máquina"

