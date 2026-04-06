# RBX Format Specification v1.1

> RebelAI native character exchange format.

## Overview

`.rbx` (Rebel eXchange) is RebelAI's native character format. It serializes the internal data model into a portable, environment-independent package.

### Design Principles

1. **Portable by default**: All cross-references use `file_name` — no DB IDs, no environment-specific URLs. The importer resolves `file_name` to runtime values (asset IDs, public URLs) at import time.
2. **No scripts**: Lua/JS execution is excluded from the spec entirely (security by design).
3. **No raw HTML**: New UI should be expressed through Safe UGC UI card JSON (declarative DSL), where security is guaranteed by closed vocabulary, not by sanitization. Legacy `background_html` is deprecated, rejected on new import, and no longer rendered by the active chat runtime.
4. **Explicit references**: Assets are referenced by `file_name`, not URI schemes or fuzzy matching.
5. **Single version**: No V1/V2/V3 branching. One spec, one parser.

---

## File Structure

An `.rbx` file is a **ZIP archive** containing:

```
character.rbx (ZIP)
├── manifest.json           # Character data + asset manifest
├── assets/                 # Character-level asset files
│   ├── icon.webp           # Character avatar (asset_type: "icon")
│   ├── npc_alice.png       # NPC image (asset_type: "character_image")
│   ├── emotion_happy.webp  # Emotion image (asset_type: "character_image")
│   └── ...
└── module_assets/          # Module-level asset files (keyed by module index)
    ├── 0/                  # Assets for modules[0]
    │   ├── background.png
    │   └── overlay.webp
    └── 1/                  # Assets for modules[1]
        └── badge.png
```

- `manifest.json` is **required** and must be at the ZIP root.
- `assets/` directory is optional. If the character has no character-level assets, it may be omitted.
- `module_assets/` directory is optional. If no modules have assets, it may be omitted. Subdirectories are named by the module's zero-based index in the `modules[]` array.
- Asset files are referenced by their filename in the manifest (character assets in `assets[]`, module assets in `modules[].module.assets[]`).

### Detection

Parsers identify `.rbx` files by the ZIP magic bytes (`PK\x03\x04`) at offset 0.

---

## manifest.json Schema

### Top-Level

| Field       | Type                 | Required | Description                                          |
| ----------- | -------------------- | -------- | ---------------------------------------------------- |
| `format`    | `"rbx"`              | Yes      | Format identifier. Must be `"rbx"`.                  |
| `version`   | `string`             | Yes      | Spec version (e.g., `"1.0"`).                        |
| `character` | `Character`          | Yes      | Character data.                                      |
| `assets`    | `Asset[]`            | No       | Asset manifest. Defaults to `[]`.                    |
| `modules`   | `ModuleAttachment[]` | No       | Module data with attachment state. Defaults to `[]`. |

### Character

Maps to the `characters` database table.

| Field              | Type                               | Required | Default     | Description                                                                                          |
| ------------------ | ---------------------------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `name`             | `string`                           | Yes      | —           | Character display name.                                                                              |
| `description`      | `string \| null`                   | No       | `null`      | Character description. Used for both UI display and as system prompt fallback (see Import Behavior). |
| `system_prompt`    | `string`                           | Yes      | —           | AI system instructions. This is the primary prompt sent to the LLM.                                  |
| `greeting_message` | `string \| null`                   | No       | `null`      | First message shown when a chat starts.                                                              |
| `visibility`       | `"private" \| "draft" \| "public"` | No       | `"private"` | Character visibility setting.                                                                        |
| `metadata`         | `CharacterMetadata`                | No       | `{}`        | Extended character configuration.                                                                    |

#### Import Behavior: `description` and `system_prompt`

Both fields are stored as provided. At runtime, the system prompt is resolved as:

```
effective_system_prompt = character.system_prompt || character.description
```

This matches the current charx V3 import behavior where `description` serves as the primary content field and `system_prompt` is a secondary override.

### CharacterMetadata

Stored as JSON in `characters.metadata`.

| Field                       | Type                          | Default       | Description                                                                                                                                                               |
| --------------------------- | ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                      | `"character" \| "simulation"` | `"character"` | Character mode. `"simulation"` enables multi-NPC features.                                                                                                                |
| `post_history_instructions` | `string \| null`              | `null`        | Plain-text instructions injected after chat history.                                                                                                                      |
| `alternate_greetings`       | `string[]`                    | `[]`          | Alternative first messages.                                                                                                                                               |
| `ui_card`                   | `object \| null`              | `null`        | Legacy single-card inline UI definition. Used when `extract` entries omit `card_ref`. See §6.                                                                             |
| `ui_cards`                  | `Record<string, object>`      | `{}`          | Named inline card registry. `extract.card_ref` resolves against this map, enabling multiple independent cards in one message without inlining UI JSON into regex entries. |
| `background_html`           | `string \| null`              | `null`        | **DEPRECATED (v1.1)**. Legacy raw CSS/HTML payload. Rejected on new import and no longer rendered by the active chat runtime.                                             |
| `default_variables`         | `Record<string, unknown>`     | `{}`          | Initial variable state for `ui_card` / `ui_cards` bindings and other runtime state consumers.                                                                             |
| `character_list`            | `string[]`                    | `[]`          | NPC names for simulation mode.                                                                                                                                            |
| `image_commands`            | `Record<string, string>`      | `{}`          | NPC name to asset `file_name` mapping. Importer resolves `file_name` → `asset_id` for DB storage.                                                                         |
| `image_display`             | `object \| null`              | `null`        | UCC card template for emotion image rendering. Uses `@assets/emotion` as a dynamic placeholder resolved per-image. See §6.1.                                              |

> **Removed in v1.1**: `emotion_images` — runtime never consumed this field. Emotion display is handled through the existing asset resolution pipeline: the canonical inline token is `![alt](asset:key)`, and the renderer resolves `asset:key` via asset `canonical_name` matching and `image_commands` mapping. No dedicated emotion-to-asset field is needed.

#### Import Resolution for `image_commands`

In the `.rbx` file, `image_commands` references assets by `file_name` for portability:

```json
"image_commands": { "Bartender": "npc_bartender.png" }
```

The importer resolves these to runtime values after uploading assets:

| Field            | .rbx file (portable) | DB storage (runtime)                         |
| ---------------- | -------------------- | -------------------------------------------- |
| `image_commands` | `file_name`          | `asset_id` (UUID from `character_assets.id`) |

The exporter performs the reverse mapping: `asset_id` → `file_name`.

### Asset

Maps to the `character_assets` database table.

| Field            | Type             | Required | Default | Description                                   |
| ---------------- | ---------------- | -------- | ------- | --------------------------------------------- |
| `file_name`      | `string`         | Yes      | —       | Filename within `assets/` directory.          |
| `asset_type`     | `AssetType`      | Yes      | —       | Asset category.                               |
| `content_type`   | `string \| null` | No       | `null`  | MIME type (e.g., `"image/webp"`).             |
| `display_name`   | `string \| null` | No       | `null`  | Human-readable name for UI.                   |
| `canonical_name` | `string \| null` | No       | `null`  | Name used in `{{assetlist}}` template output. |
| `display_order`  | `number`         | No       | `0`     | Sort order for UI display.                    |
| `metadata`       | `AssetMetadata`  | No       | `{}`    | Extended asset metadata.                      |

**AssetType** enum: `"icon"` | `"character_image"` | `"background"` | `"other"`

> **Note on emotion images**: Emotion images use `asset_type: "character_image"` (not a separate `"emotion"` type). This matches the current DB schema which only defines `icon | character_image | background | other`. Emotion semantics are resolved through existing asset lookup (`canonical_name`, aliases, `image_commands`, and `image_display`), not through a dedicated asset type.

### AssetMetadata

| Field     | Type       | Default | Description                             |
| --------- | ---------- | ------- | --------------------------------------- |
| `aliases` | `string[]` | `[]`    | Alternative names for asset resolution. |

Additional metadata fields (e.g., generation tool info) may be present and are preserved but not required.

### ModuleAttachment

Wraps a `Module` with attachment state from the `character_modules` join table.

| Field      | Type      | Required | Default | Description                                                                                                |
| ---------- | --------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | No       | `true`  | Whether this module is active for the character.                                                           |
| `priority` | `number`  | No       | `0`     | Module processing order. Stored as provided; interpretation depends on the runtime query (see note below). |
| `module`   | `Module`  | Yes      | —       | The module data.                                                                                           |

> **Note on `priority` ordering**: The current codebase has inconsistent sort direction — the system prompt builder reads `priority DESC` (higher value = processed first) while the assets API reads `priority ASC`. The DB schema documents it as "Higher = applied first". The `.rbx` format stores the raw value without prescribing sort direction; the importer writes it as-is to `character_modules.priority`. This inconsistency should be resolved in the runtime before the spec can mandate a direction.

### Module

Maps to the `modules` database table (see `Module` interface in `risuai.types.ts`).

| Field         | Type                 | Required | Default | Description                                                           |
| ------------- | -------------------- | -------- | ------- | --------------------------------------------------------------------- |
| `name`        | `string`             | Yes      | —       | Module display name.                                                  |
| `description` | `string \| null`     | No       | `null`  | Module description.                                                   |
| `lorebook`    | `LorebookEntry[]`    | No       | `[]`    | Lorebook entries.                                                     |
| `regex`       | `RegexEntry[]`       | No       | `[]`    | Text transformations and data extraction. No scripts, no HTML output. |
| `hide_icon`   | `boolean`            | No       | `false` | Whether to hide module icon in UI.                                    |
| `assets`      | `ModuleAssetEntry[]` | No       | `[]`    | Module-specific assets.                                               |

> **Removed in v1.1**: `triggers`, `toggle_definitions` — interactive controls (buttons, toggles, variable mutation) are now expressed through `ui_card` Button/Toggle components. See §6.

### LorebookEntry

| Field          | Type             | Required | Default | Description                                                  |
| -------------- | ---------------- | -------- | ------- | ------------------------------------------------------------ |
| `key`          | `string`         | Yes      | —       | Comma-separated trigger keywords.                            |
| `secondkey`    | `string`         | No       | `""`    | Secondary keywords (AND condition when `selective` is true). |
| `content`      | `string`         | Yes      | —       | Content injected when triggered.                             |
| `insertorder`  | `number`         | No       | `0`     | Insertion priority (lower = earlier).                        |
| `alwaysActive` | `boolean`        | No       | `false` | Always inject regardless of keywords.                        |
| `selective`    | `boolean`        | No       | `false` | Require both primary and secondary keys.                     |
| `useRegex`     | `boolean`        | No       | `false` | Treat keys as regex patterns.                                |
| `comment`      | `string \| null` | No       | `null`  | Author note (not sent to LLM).                               |

### RegexEntry

| Field      | Type                     | Required | Default | Description                                                                                |
| ---------- | ------------------------ | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `in`       | `string`                 | Yes      | —       | Regex pattern to match.                                                                    |
| `out`      | `string`                 | Yes      | —       | Replacement string (text types) or empty string (extract type).                            |
| `type`     | `string`                 | Yes      | —       | Processing context. See types below.                                                       |
| `bindings` | `Record<string, string>` | No       | `{}`    | Capture group → variable mapping. Only used with `type: "extract"`.                        |
| `card_ref` | `string`                 | No       | —       | Named card reference for inline rendering. Resolves against `character.metadata.ui_cards`. |

#### Regex Types

| Type         | Description                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `editinput`  | Transform text before sending to LLM. Pure text replacement.                                     |
| `editoutput` | Transform LLM output before processing. Pure text replacement. **HTML tags forbidden in `out`.** |
| `extract`    | Extract structured data from LLM output into variables via `bindings`. `out` should be `""`.     |

> **Removed in v1.1**: `editdisplay` — this type generated raw HTML for rendering, which was a security risk. Use `extract` + `ui_card` `$ref` binding instead.

#### Extract Type

The `extract` type parses LLM output using capture groups and binds results to variables that an inline card can reference via `$ref`. Each match can render its own card instance.

```json
{
  "in": "\\[HP:(\\d+)/(\\d+)\\|Location:([^\\]]+)\\]",
  "out": "",
  "type": "extract",
  "bindings": { "hp": "$1", "maxHp": "$2", "location": "$3" },
  "card_ref": "status"
}
```

When the LLM outputs `[HP:87/100|Location:Seoul]`, the regex extracts:

- `hp` = `"87"`, `maxHp` = `"100"`, `location` = `"Seoul"`

If `card_ref` is present, the runtime looks up `character.metadata.ui_cards[card_ref]` and renders that card at the match span. If `card_ref` is omitted, the runtime falls back to the legacy `character.metadata.ui_card`.

These variables are merged into the matched card instance state and accessible via the card's `{ "$ref": "$hp" }`.

**Binding rules:**

- Keys are variable names (without `$` prefix)
- Values are capture group references: `$1`, `$2`, ... `$99`
- Extracted values are always strings; numeric conversion is the runtime's responsibility
- Variables are written to the same namespace as `default_variables`

**HTML prohibition:**

- `editoutput` and `extract` types: if `out` contains `<` followed by a letter (HTML tag pattern), the parser emits a warning. The runtime may strip or reject such output.
- `editinput` is exempt (it modifies user input before LLM, not display output).

> **Note**: The `script` field from CharX/RisuAI modules is intentionally excluded. All scripting is forbidden in .rbx for security.

### ModuleAssetEntry

Maps to the `module_assets` database table. Binary files are stored in `module_assets/{index}/` within the ZIP.

| Field           | Type             | Required | Default | Description                                         |
| --------------- | ---------------- | -------- | ------- | --------------------------------------------------- |
| `file_name`     | `string`         | Yes      | —       | Filename within `module_assets/{index}/` directory. |
| `content_type`  | `string \| null` | No       | `null`  | MIME type (e.g., `"image/webp"`).                   |
| `display_name`  | `string \| null` | No       | `null`  | Human-readable name for UI.                         |
| `display_order` | `number`         | No       | `0`     | Sort order for UI display.                          |
| `metadata`      | `object`         | No       | `{}`    | Extended metadata (e.g., `aliases`).                |

#### Module Asset Import/Export

**Import**: For each `modules[i].module.assets[]` entry, the importer reads the binary from `module_assets/{i}/{file_name}`, uploads it to the `module-assets` storage bucket, and creates a `module_assets` DB row linked to the created module.

**Export**: The exporter reads `module_assets` rows for each module, downloads binaries from the `module-assets` bucket, and writes them to `module_assets/{i}/` in the ZIP.

---

## UI Card (Safe UGC UI Integration)

The `ui_card` field in CharacterMetadata holds a **Safe UGC UI card JSON** — a declarative UI definition that replaces raw HTML/CSS for all visual customization (status panels, stat displays, interactive controls, background styling).

### Why Not HTML

In v1.0, `background_html` stored raw CSS/HTML that required sanitization at render time (DOMPurify + CSS scoping). This created an ongoing security surface: every new CSS feature could potentially be exploited, and regex `editdisplay` output generated raw HTML that could bypass sanitization. The `ui_card` approach eliminates this entirely — the renderer only understands a fixed set of 16 component types and whitelisted style properties. There is no HTML parsing path.

### Card Structure

A `ui_card` follows the Safe UGC UI Card Spec (Phase 2). See the [SUU project](../../../SUU/safe-ugc-ui-card-spec.md) for full details, or [`safe-ugc-ui-card-spec-lite.md`](../../../SUU/safe-ugc-ui-card-spec-lite.md) for the LLM-friendly summary.

```json
{
  "meta": { "name": "card-name", "version": "1.0.0" },
  "assets": { "avatar": "@assets/avatar.png" },
  "state": { "hp": 100, "maxHp": 100 },
  "styles": { "statLabel": { "fontSize": 10, "color": "#555570" } },
  "views": {
    "Main": { "type": "Box", "children": [ ... ] }
  }
}
```

| Field    | Required | Description                                       |
| -------- | -------- | ------------------------------------------------- |
| `meta`   | Yes      | Card name and version.                            |
| `assets` | No       | Asset manifest. Values must use `@assets/` paths. |
| `state`  | No       | Initial state values for `$ref` binding.          |
| `styles` | No       | Reusable named style definitions.                 |
| `views`  | Yes      | Named view trees. At least one view required.     |

### Components (16 types)

**Layout**: `Box`, `Row`, `Column`, `Stack`, `Grid` — contain `children`
**Content**: `Text`, `Image`, `Avatar`, `Icon`, `Spacer`, `Divider`, `ProgressBar`, `Badge`, `Chip`
**Interaction**: `Button` (triggers action callback), `Toggle` (boolean switch)

All component fields are top-level on the node (no `props` wrapper).

### State Binding with $ref

Use `{ "$ref": "$variableName" }` to bind state values into component fields or style properties.

**State merging priority** (highest wins):

1. matched regex `extract` results (real-time data from the specific LLM output span)
2. `default_variables` from CharacterMetadata
3. matched card's `.state` initial values

This means each rendered card instance keeps its own extracted state, while `default_variables` still provide shared chat-level fallbacks.

### Asset References

Images in `ui_card` use `@assets/filename.png` paths:

```json
{ "type": "Image", "src": "@assets/npc_bartender.png" }
```

The runtime resolves `@assets/` paths by matching against the `.rbx` manifest's `assets[]` entries by `file_name`. External URLs (`https://`, `http://`, `data:`) are forbidden.

### Security Model

The Safe UGC UI card format provides **structural security** — the format itself cannot express dangerous constructs:

- **No XSS** — no `<script>`, no event handlers, no `javascript:` URIs (not in the grammar)
- **No data exfiltration** — no `url()`, no external resource loading (images must use `@assets/`)
- **No UI hijacking** — no `position: fixed/sticky`, `z-index` capped at 0-100
- **No CSS injection** — no `calc()`, `var()`, `expression()` in style values

> **Runtime integration status**: `ui_card` is already wired into the RebelAI runtime and renders through `@safe-ugc-ui/react`. The remaining gap is **import-time** validation with `@safe-ugc-ui/validator` inside the RBX import path. See §9 Runtime Status.

### §6.1 Image Display Template

The `image_display` field defines how emotion images in chat messages are rendered. It is a UCC card definition that acts as a **template** applied to every resolved emotion image.

When `image_display` is present, the renderer uses `UGCRenderer` instead of the default hardcoded `<Image>` component. When absent, the default rendering (`<Image width={400} height={400}>`) is used for backward compatibility.

**Canonical inline token**: Emotion or character image references in generated text should use markdown asset images such as `![hero smile](asset:happy)`. The runtime currently normalizes older syntaxes like `<img="happy">`, `[ 🖼 | happy ]`, and `{{image::happy}}` into this canonical form, but new content should emit the markdown form directly.

**Dynamic placeholder**: The template must use `@assets/emotion` as the image source. At render time, this placeholder is resolved to the actual emotion URL for each image tag independently.

**Per-card template, per-image state**: One `image_display` template still applies to all emotion images in the card, but each rendered instance now receives its own `runtime.image` state object. Card authors can bind styles and conditions against `runtime.image.*` without changing the shared template.

**Asset metadata hints**: When available, the runtime reads `asset.metadata.image_display` first and `asset.metadata.ui` second for optional `character`, `variant`, `theme`, `flags`, and `tokens` fields. If those hints are absent, the runtime falls back to best-effort parsing from `canonical_name`.

**Example** — hover-to-expand (진설 card pattern):

```json
"image_display": {
  "meta": { "name": "img-display", "version": "1.0.0" },
  "views": {
    "Main": {
      "type": "Container",
      "style": {
        "width": "30em",
        "height": "25em",
        "overflow": "hidden",
        "borderRadius": 20
      },
      "hoverStyle": { "height": "44em" },
      "transition": [{ "property": "height", "duration": 600, "easing": "ease" }],
      "children": [
        {
          "type": "Image",
          "src": "@assets/emotion",
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        }
      ]
    }
  }
}
```

This replaces the legacy pattern of using `background_html` CSS with `.image-container:hover` selectors, providing the same visual effect within UCC's secure closed vocabulary.

### Interaction Model (replaces triggers)

In v1.0, `triggers` with `v2SetVar` effects provided interactive buttons. In v1.1, this is replaced by `ui_card` interaction components:

**Button** — sets a variable to `true` on click:

```json
{ "type": "Button", "label": "Wide View", "action": "wideView" }
```

**Toggle** — flips a boolean variable:

```json
{ "type": "Toggle", "value": { "$ref": "$darkMode" }, "onToggle": "darkMode" }
```

The runtime uses the `action`/`onToggle` string directly as the variable name. For Button, the variable is set to `true`. For Toggle, the variable receives the new boolean value from the renderer. Card authors should use the actual variable name (e.g., `"wideView"`) rather than a verb-prefixed form (e.g., `"setWideView"`).

### Example: RPG Status Panel

```json
{
  "meta": { "name": "rpg-status", "version": "1.0.0" },
  "assets": { "portrait": "@assets/portrait.png" },
  "state": {
    "hp": 100,
    "maxHp": 100,
    "mp": 50,
    "maxMp": 50,
    "location": "Starting Village",
    "emotion": "neutral",
    "level": "1"
  },
  "styles": {
    "statLabel": { "fontSize": 10, "color": "#555570", "letterSpacing": 2 },
    "statValue": { "fontSize": 16, "fontWeight": "bold" }
  },
  "views": {
    "Main": {
      "type": "Column",
      "style": { "gap": 8, "padding": 16, "backgroundColor": "#0a0a12", "borderRadius": 12 },
      "children": [
        {
          "type": "Row",
          "style": { "gap": 12, "alignItems": "center" },
          "children": [
            { "type": "Avatar", "src": "@assets/portrait.png", "size": 48 },
            {
              "type": "Column",
              "style": { "gap": 2 },
              "children": [
                {
                  "type": "Text",
                  "content": { "$ref": "$location" },
                  "style": { "fontSize": 14, "color": "#00f0ff" }
                },
                {
                  "type": "Row",
                  "style": { "gap": 6 },
                  "children": [
                    { "type": "Badge", "label": { "$ref": "$emotion" }, "color": "#ff0066" },
                    { "type": "Chip", "label": { "$ref": "$level" }, "color": "#ffcc00" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "Column",
          "style": { "gap": 4 },
          "children": [
            {
              "type": "Row",
              "style": { "justifyContent": "space-between" },
              "children": [
                { "type": "Text", "content": "HP", "style": { "$style": "statLabel" } },
                {
                  "type": "Text",
                  "content": { "$ref": "$hp" },
                  "style": { "$style": "statValue", "color": "#00ff88" }
                }
              ]
            },
            {
              "type": "ProgressBar",
              "value": { "$ref": "$hp" },
              "max": { "$ref": "$maxHp" },
              "color": "#00ff88"
            },
            {
              "type": "Row",
              "style": { "justifyContent": "space-between" },
              "children": [
                { "type": "Text", "content": "MP", "style": { "$style": "statLabel" } },
                {
                  "type": "Text",
                  "content": { "$ref": "$mp" },
                  "style": { "$style": "statValue", "color": "#4488ff" }
                }
              ]
            },
            {
              "type": "ProgressBar",
              "value": { "$ref": "$mp" },
              "max": { "$ref": "$maxMp" },
              "color": "#4488ff"
            }
          ]
        }
      ]
    }
  }
}
```

Combined with an `extract` regex:

```json
{
  "in": "\\[HP:(\\d+)/(\\d+)\\|MP:(\\d+)/(\\d+)\\|Location:([^|\\]]+)\\|Emotion:([^\\]]+)\\]",
  "out": "",
  "type": "extract",
  "bindings": {
    "hp": "$1",
    "maxHp": "$2",
    "mp": "$3",
    "maxMp": "$4",
    "location": "$5",
    "emotion": "$6"
  }
}
```

When the LLM outputs `[HP:87/100|MP:32/50|Location:Dark Forest|Emotion:cautious]`, the status panel updates automatically through `$ref` binding.

---

## Compatibility Appendix: Legacy Format Comparison

This appendix is for migration tooling and archived compatibility workflows. RBX should be treated as the primary authoring and exchange format for new RebelAI-native content.

| Aspect                    | CharX                                         | .rbx v1.1                                                    |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `description` semantics   | Primary content field (used as system prompt) | Stored as-is; system_prompt takes priority at runtime        |
| `system_prompt` semantics | Secondary override                            | **Primary** AI instructions                                  |
| `defaultVariables`        | String parsing (`key=val\n`)                  | Native JSON                                                  |
| Asset references          | URI schemes + 4-tier fuzzy matching           | Direct `file_name` reference                                 |
| `image_commands` storage  | N/A (built at import from asset matching)     | `file_name` in format, `asset_id` in DB                      |
| Module attachment         | Implicit (embedded in card)                   | Explicit (`enabled`, `priority` per module)                  |
| Module encoding           | RPack (S-box cipher)                          | Plain JSON                                                   |
| Scripting                 | Lua/JS included (ignored by RebelAI)          | **Excluded from spec**                                       |
| UI/Styling                | Raw HTML/CSS (`backgroundHTML`)               | **Safe UGC UI card JSON** (declarative DSL, no HTML parsing) |
| Interactive controls      | Lua triggers + v2SetVar                       | **ui_card Button/Toggle** components                         |
| Status display            | regex OUT → raw HTML                          | regex `extract` → variables → ui_card `$ref`                 |
| Version branching         | V1/V2/V3                                      | Single version                                               |
| Lorebook format           | V3 spec → RisuAI conversion                   | RisuAI format directly                                       |

---

## Compatibility Appendix: Legacy-to-RBX Field Mapping

For implementors building legacy-format → `.rbx` converters:

| CharX Field                                    | .rbx Field                                     | Transformation                                                                                            |
| ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `card.data.name`                               | `character.name`                               | Direct copy                                                                                               |
| `card.data.description`                        | `character.description`                        | Direct copy (preserved as-is)                                                                             |
| `card.data.system_prompt`                      | `character.system_prompt`                      | Direct copy. If empty, copy `card.data.description`                                                       |
| `card.data.first_mes`                          | `character.greeting_message`                   | Direct copy                                                                                               |
| `card.data.post_history_instructions`          | `character.metadata.post_history_instructions` | Direct copy                                                                                               |
| `card.data.alternate_greetings`                | `character.metadata.alternate_greetings`       | Direct copy                                                                                               |
| `card.data.extensions.risuai.backgroundHTML`   | `character.metadata.background_html`           | Direct copy. **Deprecated** — LLM converter should generate `ui_card` instead.                            |
| `card.data.extensions.risuai.defaultVariables` | `character.metadata.default_variables`         | **Parse**: `"key=val\nkey2=val2"` → `{"key": "val", "key2": "val2"}`                                      |
| `card.data.assets[]`                           | `assets[]`                                     | Map `name` → `display_name`, extract filename from `uri` → `file_name`                                    |
| NPC assets                                     | `character.metadata.image_commands`            | Map NPC name → asset `file_name`                                                                          |
| `card.data.character_book.entries`             | `modules[].module.lorebook`                    | **Convert**: V3 `keys[]` → comma-separated `key` string                                                   |
| `module.risum`                                 | Decode first                                   | **Decode**: RPack S-box cipher → plain JSON                                                               |
| `module.risum.regex[]`                         | `modules[].module.regex[]`                     | Copy `in`/`out`/`type` only. **Drop** `script` field. Convert `editdisplay` → `extract` where applicable. |
| `module.risum.trigger[]`                       | —                                              | **Dropped in v1.1**. Convert to `ui_card` Button/Toggle components via LLM analysis.                      |
| —                                              | `modules[].enabled`                            | Default to `true`                                                                                         |
| —                                              | `modules[].priority`                           | Default to `0`                                                                                            |
| `card.data.personality`                        | —                                              | Ignored (V1/V2 legacy)                                                                                    |
| `card.data.scenario`                           | —                                              | Ignored (V1/V2 legacy)                                                                                    |
| `card.data.mes_example`                        | —                                              | Ignored                                                                                                   |
| `card.data.creator`                            | —                                              | Ignored                                                                                                   |
| `card.data.creator_notes`                      | —                                              | Ignored                                                                                                   |
| `card.data.character_version`                  | —                                              | Ignored                                                                                                   |
| `card.data.tags`                               | —                                              | Ignored                                                                                                   |

---

## Runtime Status

This section tracks the implementation status of v1.1 features in the RebelAI runtime.

| Feature                      | Spec         | Parser                      | Importer                           | Runtime Rendering                                       | Status                       |
| ---------------------------- | ------------ | --------------------------- | ---------------------------------- | ------------------------------------------------------- | ---------------------------- |
| `ui_card` field              | ✅           | ✅ stored as-is             | ✅ saved to DB                     | ✅ `UGCRenderer` in ChatInterface                       | **Functional**               |
| `ui_cards` registry          | ✅           | ✅ stored as-is             | ✅ saved to DB                     | ✅ `extract.card_ref` resolves named cards              | **Functional**               |
| `extract` regex type         | ✅           | ✅ parsed with bindings     | ✅ saved to DB                     | ✅ per-match bindings wired to ui_card / ui_cards state | **Functional**               |
| `background_html` deprecated | ✅           | ❌ rejects populated values | ✅ defensive strip if bypassed     | ❌ no longer rendered by the active chat runtime        | **Removed from active path** |
| `emotion_images` removed     | ✅           | ❌ rejects populated values | ✅ ignored if bypassed             | N/A                                                     | **Write-blocked legacy**     |
| `triggers` removed from spec | ✅           | ❌ rejects populated values | ✅ no longer persisted             | ❌ no longer read by assets/chat runtime                | **Removed from new path**    |
| `toggle_definitions` removed | ✅           | ❌ rejects populated values | ✅ no longer persisted             | ❌ no longer exposed by chat/runtime UI                 | **Removed from active path** |
| `editdisplay` removed        | ✅           | ❌ rejected by schema       | ✅ no longer persisted as behavior | ❌ no longer applied by message/background rendering    | **Removed from new path**    |
| SUU validator integration    | ✅ described | ❌                          | ❌                                 | ✅ via `UGCRenderer` (validates internally)             | **Runtime only**             |

**What works today**: v1.1-style `.rbx` files parse and import successfully. New content may use `ui_card`, `ui_cards`, and `extract`. The import path rejects populated legacy fields such as `background_html`, `emotion_images`, `triggers`, `toggle_definitions`, and `editdisplay`, and the active chat runtime no longer executes those legacy paths.

**Remaining**: Add `@safe-ugc-ui/validator` to the import path (`rbx-importer.ts`) for import-time validation of `ui_card` structure. Currently validation only happens at render time inside `UGCRenderer`.

---

## Versioning

- **1.0**: Initial release.
- **1.1**: Current spec. Added `ui_card` (Safe UGC UI integration), `extract` regex type with variable bindings. Deprecated `background_html`. Removed `emotion_images`, `triggers`, `toggle_definitions`, `editdisplay`.
- **Minor versions** (1.x): Additive field additions. Backward compatible — older parsers ignore unknown fields.
- **Major versions** (2.0): Breaking schema changes. Requires migration logic. Will remove deprecated fields (`background_html`).

Parsers must check `version` and handle unknown fields gracefully (ignore, not error).

---

## Example manifest.json

### Simple Character (no assets)

```json
{
  "format": "rbx",
  "version": "1.1",
  "character": {
    "name": "Alice",
    "description": "A friendly AI assistant",
    "system_prompt": "You are Alice, a helpful and cheerful assistant. You speak casually and enjoy helping people with their questions.",
    "greeting_message": "Hey there! I'm Alice. What can I help you with today?",
    "metadata": {}
  }
}
```

### Character with Assets and Module

```json
{
  "format": "rbx",
  "version": "1.1",
  "character": {
    "name": "Sakura",
    "description": "A magical girl character with emotion expressions",
    "system_prompt": "You are Sakura, a magical girl who protects the city...",
    "greeting_message": "Hi! I'm Sakura! Ready for an adventure?",
    "metadata": {
      "type": "character",
      "alternate_greetings": [
        "Oh, you startled me! I was just practicing my spells...",
        "*waves wand* Welcome! I've been expecting you!"
      ],
      "default_variables": {
        "affection": "0",
        "magic_level": "1"
      },
      "ui_card": {
        "meta": { "name": "sakura-stats", "version": "1.0.0" },
        "assets": { "portrait": "@assets/icon.webp" },
        "state": { "affection": "0", "magic_level": "1" },
        "views": {
          "Main": {
            "type": "Row",
            "style": {
              "gap": 12,
              "padding": 12,
              "backgroundColor": "rgba(252,228,236,0.9)",
              "borderRadius": 12
            },
            "children": [
              { "type": "Avatar", "src": "@assets/icon.webp", "size": 48 },
              {
                "type": "Column",
                "style": { "gap": 4 },
                "children": [
                  {
                    "type": "Text",
                    "content": "Sakura",
                    "style": { "fontSize": 16, "fontWeight": "bold", "color": "#d81b60" }
                  },
                  {
                    "type": "Row",
                    "style": { "gap": 6 },
                    "children": [
                      { "type": "Chip", "label": { "$ref": "$magic_level" }, "color": "#7b1fa2" },
                      { "type": "Badge", "label": { "$ref": "$affection" }, "color": "#e91e63" }
                    ]
                  }
                ]
              }
            ]
          }
        }
      }
    }
  },
  "assets": [
    {
      "file_name": "icon.webp",
      "asset_type": "icon",
      "content_type": "image/webp",
      "display_name": "Sakura Avatar",
      "display_order": 0
    },
    {
      "file_name": "emotion_happy.webp",
      "asset_type": "character_image",
      "content_type": "image/webp",
      "display_name": "Happy",
      "canonical_name": "happy",
      "display_order": 1
    },
    {
      "file_name": "emotion_sad.webp",
      "asset_type": "character_image",
      "content_type": "image/webp",
      "display_name": "Sad",
      "canonical_name": "sad",
      "display_order": 2
    },
    {
      "file_name": "emotion_angry.webp",
      "asset_type": "character_image",
      "content_type": "image/webp",
      "display_name": "Angry",
      "canonical_name": "angry",
      "display_order": 3
    }
  ],
  "modules": [
    {
      "enabled": true,
      "priority": 0,
      "module": {
        "name": "Sakura Lorebook",
        "description": "World-building entries for Sakura's story",
        "lorebook": [
          {
            "key": "magic,spell,wand",
            "content": "Sakura's magic comes from her Star Wand, which channels cosmic energy. She can cast protection spells, healing light, and barrier shields.",
            "insertorder": 100,
            "alwaysActive": false,
            "selective": false,
            "useRegex": false,
            "comment": "Magic system basics"
          },
          {
            "key": "school,class,academy",
            "content": "Sakura attends Moonlight Academy, a school for magical girls. Classes include Spell Theory, Combat Training, and Familiar Bond.",
            "insertorder": 200,
            "alwaysActive": false,
            "selective": false,
            "useRegex": false,
            "comment": "School setting"
          }
        ],
        "regex": [],
        "hide_icon": false,
        "assets": []
      }
    }
  ]
}
```

### Simulation (Multi-NPC) with UI Card

```json
{
  "format": "rbx",
  "version": "1.1",
  "character": {
    "name": "Fantasy Tavern",
    "description": "A multi-NPC tavern simulation",
    "system_prompt": "You are narrating a fantasy tavern scene with multiple characters...",
    "greeting_message": "You push open the heavy wooden door of The Golden Flagon...",
    "metadata": {
      "type": "simulation",
      "character_list": ["Bartender", "Elf Ranger", "Dwarf Smith"],
      "image_commands": {
        "Bartender": "npc_bartender.png",
        "Elf Ranger": "npc_elf.png",
        "Dwarf Smith": "npc_dwarf.png"
      },
      "post_history_instructions": "When a character speaks, use {{img::CharacterName}} to display their image.",
      "default_variables": {
        "wideView": "0",
        "sceneHeight": "100"
      },
      "ui_card": {
        "meta": { "name": "tavern-controls", "version": "1.0.0" },
        "state": { "wideView": false, "sceneHeight": "100" },
        "views": {
          "Main": {
            "type": "Column",
            "style": { "gap": 8, "padding": 12, "backgroundColor": "#1a1208", "borderRadius": 8 },
            "children": [
              {
                "type": "Row",
                "style": { "justifyContent": "space-between", "alignItems": "center" },
                "children": [
                  {
                    "type": "Text",
                    "content": "Wide View",
                    "style": { "fontSize": 13, "color": "#c8a96e" }
                  },
                  { "type": "Toggle", "value": { "$ref": "$wideView" }, "onToggle": "wideView" }
                ]
              },
              { "type": "Divider", "color": "#2a2218" },
              {
                "type": "Row",
                "style": { "gap": 8 },
                "children": [
                  { "type": "Button", "label": "Reset Height", "action": "sceneHeightReset" }
                ]
              }
            ]
          }
        }
      }
    }
  },
  "assets": [
    {
      "file_name": "icon.webp",
      "asset_type": "icon",
      "content_type": "image/webp",
      "display_order": 0
    },
    {
      "file_name": "npc_bartender.png",
      "asset_type": "character_image",
      "content_type": "image/png",
      "display_name": "Bartender",
      "canonical_name": "Bartender",
      "display_order": 1
    },
    {
      "file_name": "npc_elf.png",
      "asset_type": "character_image",
      "content_type": "image/png",
      "display_name": "Elf Ranger",
      "canonical_name": "Elf Ranger",
      "display_order": 2
    },
    {
      "file_name": "npc_dwarf.png",
      "asset_type": "character_image",
      "content_type": "image/png",
      "display_name": "Dwarf Smith",
      "canonical_name": "Dwarf Smith",
      "display_order": 3
    }
  ],
  "modules": [
    {
      "enabled": true,
      "priority": 0,
      "module": {
        "name": "Tavern Lorebook",
        "description": "World-building entries for the tavern",
        "lorebook": [],
        "regex": [],
        "hide_icon": false,
        "assets": []
      }
    }
  ]
}
```
