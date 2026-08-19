# demo_client — configuración de propuestas

> Generado desde la hoja **Proposal Config** de este cliente con `node scripts/client-docs.js demo_client`.
> No lo edites a mano: edita la hoja y vuelve a generarlo, o dejará de reflejar la realidad.

## Qué produce este cliente

- **Idioma por defecto:** es
- **Peso del documento por defecto:** B — propuesta estándar (15-25 pág.)
- **Versión del documento:** 1.0
- **Capítulos configurados:** 17
- **Cláusulas propias:** 46

## Variables propias de este cliente

Estas son las etiquetas que **puedes usar en la plantilla `.docx`**. Cualquier otra `{campos.*}` imprimirá la palabra `undefined` en el documento del cliente.

| Etiqueta en la plantilla | De dónde sale | Obligatorio |
|---|---|---|
| `{campos.n_oferta}` | del correo, buscando `Oferta nº` o `Offer no` | no |
| `{campos.n_activo}` | del correo, buscando `Asset` o `Activo` | no |
| `{campos.n_proyecto}` | del correo, buscando `Project number` o `Nº proyecto` | no |
| `{campos.atencion}` | del correo, buscando `Att.` o `Attn` o `Atn.` | no |
| `{campos.razon_social}` | valor fijo en la hoja: `Cifral Automatización S.L.` | no |
| `{campos.n_documento}` | automático: el número de propuesta que genera Cifral | no |

## Plantillas

La pestaña `Templates` está vacía, así que se usan los ids `template_id_es` / `template_id_en` de la ficha de Notion.

## Cuánto documento sale, y de qué depende

Tres cosas deciden qué capítulos aparecen. Las dos primeras las trae **cada RFQ**; la tercera es esta hoja.

| Peso | Con todo el alcance | Sólo lo mínimo | Sin precio |
|---|---|---|---|
| **A** — presupuesto | 39 bloques, 33 cláusulas | 31 bloques | 33 bloques |
| **B** — propuesta _(por defecto)_ | 81 bloques, 46 cláusulas | 67 bloques | 72 bloques |
| **C** — licitación | 89 bloques, 55 cláusulas | 74 bloques | 79 bloques |

Un «bloque» es un capítulo o un apartado. El peso lo decide el extractor leyendo el RFQ (una licitación con pliego es `C`); si no lo tiene claro usa el `default_tier` de esta hoja.

Y el **alcance de suministro** que pida el RFQ enciende o apaga apartados concretos:

| Si el RFQ pide… | aparece |
|---|---|
| `materials` | Hardware y equipos |
| `engineering` | Ingeniería y diseño |
| `installation` | Instalación y montaje |
| `commissioning` | Puesta en marcha |
| `project_management` | Organización y equipo |
| `spare_parts` | Recambios recomendados |
| `shipping` | Transporte, embalaje y entrega |
| `training` | Formación |
| `warranty` | Alcance y periodo de garantía |
| un precio (`pricing_only` / `full_pipeline`) | Oferta económica y sus 9 apartados |

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
**4.** Solución técnica propuesta
  - 4.1 Concepto y arquitectura
  - 4.2 Descripción funcional y cambios respecto a la instalación actual
  - 4.3 Control y comunicaciones
  - 4.4 Ciberseguridad OT y acceso remoto
**5.** Alcance de suministro
  - 5.1 Resumen de lo incluido y no incluido
  - 5.2 Hardware y equipos
  - 5.3 Software y licencias
  - 5.4 SCADA / HMI y visualización
  - 5.5 Ingeniería y diseño
  - 5.6 Recambios recomendados
  - 5.7 Documentación técnica entregable
**6.** Ejecución del proyecto
  - 6.1 Inspección previa y toma de datos
  - 6.2 Fases de ejecución
  - 6.3 Instalación y montaje
  - 6.4 Puesta en marcha
  - 6.5 Plan de pruebas y criterios de aceptación
  - 6.6 Periodo de demostración
  - 6.7 Formación
  - 6.8 Transporte, embalaje y entrega
  - 6.9 Recepción y aceptación
**7.** Gestión de proyecto
  - 7.1 Organización y equipo
  - 7.2 Metodología y control del proyecto
  - 7.3 Comunicación y reporting
  - 7.4 Gestión de cambios
  - 7.5 Planificación, hitos y plazo
**8.** Continuidad operativa, seguridad y riesgos
  - 8.1 Estrategia de continuidad operativa
  - 8.2 Contingencia y reversión
  - 8.3 Registro de riesgos
  - 8.4 Seguridad y salud
**9.** Condiciones técnicas y requisitos del emplazamiento
  - 9.1 Área de trabajo y accesibilidad
  - 9.2 Jornadas de trabajo y disponibilidad del sistema
  - 9.3 Accesos, permisos y acreditaciones
  - 9.4 Suministros a cargo del cliente
  - 9.5 Obligaciones del cliente
**10.** Límites del alcance
  - 10.1 Premisas e hipótesis
  - 10.2 Exclusiones
  - 10.3 Interfaces y límites de suministro
  - 10.4 Condiciones que originan una orden de cambio
**11.** Oferta económica
  - 11.1 Resumen de precios
  - 11.2 Opciones cotizadas aparte
  - 11.3 Tarifas para trabajos adicionales
  - 11.4 Conceptos no incluidos en el precio
  - 11.5 Condiciones de pago
  - 11.6 Moneda
  - 11.7 Validez de la oferta
  - 11.8 Plazo de entrega
**12.** Garantía y soporte post-venta
  - 12.1 Alcance y periodo de garantía
  - 12.2 Exclusiones de la garantía
  - 12.3 Soporte técnico y niveles de servicio
  - 12.4 Servicios recurrentes recomendados
**13.** Condiciones generales y reservas
  - 13.1 Marco contractual
  - 13.2 Responsabilidad y limitaciones
  - 13.3 Propiedad intelectual
  - 13.4 Confidencialidad
**14.** Próximos pasos y aceptación

## Capítulos disponibles pero apagados

Existen en el catálogo y **ningún RFQ puede encenderlos**: no dependen del peso ni del alcance, sólo de una fila `include=yes` en la pestaña `Chapters` de esta hoja. Es la diferencia entre lo que el sistema sabe hacer y lo que este cliente ha decidido ofrecer.

| `chapter_id` | Qué es | Peso mínimo |
|---|---|---|
| `custom_1` | Capítulo personalizado 1 | ABC |
| `custom_2` | Capítulo personalizado 2 | ABC |
| `custom_3` | Capítulo personalizado 3 | ABC |
| `custom_4` | Capítulo personalizado 4 | ABC |
| `custom_5` | Capítulo personalizado 5 | ABC |
| `anexo_cronograma` | Cronograma detallado | C |
| `anexo_bom` | Lista de materiales | C |
| `anexo_pruebas` | Protocolos de prueba FAT/SAT | C |
| `anexo_planos` | Planos y esquemas | C |
| `anexo_fichas` | Fichas técnicas de equipos | C |
| `anexo_riesgos` | Registro de riesgos completo | C |
| `anexo_referencias` | Referencias de proyectos similares | BC |
| `anexo_cvs` | CVs del equipo asignado | C |
| `anexo_condiciones` | Condiciones generales de venta | BC |
| `anexo_certificados` | Certificados y homologaciones | C |

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

