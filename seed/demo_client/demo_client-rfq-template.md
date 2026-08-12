# demo_client — plantilla de correo para pedir una propuesta

> Generado desde la hoja **Proposal Config** de este cliente. Las etiquetas de abajo son
> exactamente las que el sistema busca: si cambian en la hoja, vuelve a generar este documento.

**Para:** `proposal@cifral.io`
**Desde:** la dirección registrada en `commercial_contact_email` — el sistema identifica al cliente por ahí.
**Asunto:** RFQ — <título del proyecto>

---

```
Oferta nº: <opcional>
Asset: <opcional>
Project number: <opcional>
Att.: <opcional>

Cliente final: <razón social>
Proyecto: <título del proyecto>
Emplazamiento: <planta / ciudad>
Plazo: <fecha o trimestre>

Alcance solicitado: <suministro, ingeniería, instalación, puesta en marcha, repuestos…>

Requisitos:
  - <equipo o requisito> — <cantidad> — <especificación>
  - …

<Descripción de la situación actual y de lo que se pide.>
```

## Reglas de las etiquetas

- Cada etiqueta va **al principio de su línea**, seguida del valor. Varias en la misma línea también funcionan.
- Mayúsculas, acentos y `º`/`°` dan igual.
- El valor termina donde empieza la siguiente etiqueta, o al final de la línea.
- Una etiqueta sin nada detrás cuenta como no puesta.
- Se lee **tal cual**, sin modelo de lenguaje de por medio: lo que escribas es lo que sale en la portada.

| Etiqueta | Alternativas admitidas | Obligatorio |
|---|---|---|
| `Oferta nº` | `Offer no` | no |
| `Asset` | `Activo` | no |
| `Project number` | `Nº proyecto` | no |
| `Att.` | `Atn.`, `Attn` | no |

No hace falta escribir estas, salen solas:

- **razon_social** — fijo en la configuración: (sin valor todavía)
- **n_documento** — el número de propuesta que genera Cifral

