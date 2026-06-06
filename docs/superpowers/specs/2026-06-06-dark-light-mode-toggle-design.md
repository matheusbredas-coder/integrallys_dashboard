---
name: dark-light-mode-toggle
description: Design spec for adding a dark/light theme toggle to the Settings page using CSS variables + localStorage
metadata:
  type: project
---

# Dark / Light Mode Toggle

## Overview

Add a theme toggle to the **Configurações** page so users can switch between the existing dark theme and a new light theme. Preference is persisted in `localStorage` and applied before first paint to avoid flash.

## Approach

CSS variables + localStorage. No new dependencies. The existing `:root` variables already drive all colours — adding a `html[data-theme="light"]` override block is sufficient to support both themes.

## CSS Layer (`globals.css`)

Add a `html[data-theme="light"]` block that overrides the dark defaults:

```css
html[data-theme="light"] {
  --bg: #f4f4f6;
  --panel-from: #ffffff;
  --panel-to: #f0f0f2;
  --panel-hi: #fafafa;
  --line: #e2e2e6;
  --txt: #0a0a0b;
  --muted: #6b6b75;
  --muted2: #9090a0;
}

html[data-theme="light"] body {
  background: radial-gradient(900px 500px at 78% -8%, rgba(217,178,76,.07), transparent 60%), var(--bg);
}
```

Gold variables (`--gold`, `--gold-soft`, `--gold-deep`) are unchanged — they read well on both backgrounds.

## Flash Prevention (`src/app/layout.tsx`)

Add a `<script>` tag inside `<head>` that runs synchronously before the page renders:

```html
<script dangerouslySetInnerHTML={{ __html: `
  (function(){
    var t = localStorage.getItem('theme');
    if (t === 'light') document.documentElement.dataset.theme = 'light';
  })();
` }} />
```

This runs before React hydrates, so there is never a flash of the wrong theme.

## Theme Toggle Component (`src/components/theme-toggle.tsx`)

A `"use client"` component that:
- Reads `localStorage.getItem('theme')` on mount (defaults to `'dark'`)
- Renders a pill toggle with sun icon (light) and moon icon (dark)
- On change: writes to `localStorage` and sets/removes `document.documentElement.dataset.theme`

```
[ 🌙 Dark  |  ☀️ Light ]   ← pill toggle, active side highlighted in gold
```

No server state. No context. No provider. Pure DOM + localStorage.

## Settings Page Integration (`src/app/(app)/settings/page.tsx`)

Add an "Aparência" section above or below the existing sections:

```
┌─────────────────────────────────────────────────┐
│ Aparência                                        │
│ ─────────────────────────────────────────────── │
│ Tema           [ 🌙 Escuro  |  ☀️ Claro ]       │
└─────────────────────────────────────────────────┘
```

The section follows the same card styling used by `GoalsForm` and `AttendanceImportForm`.

## Files Changed

| File | Change |
|------|--------|
| `src/app/globals.css` | Add `html[data-theme="light"]` override block |
| `src/app/layout.tsx` | Add inline `<script>` to `<head>` for flash prevention |
| `src/components/theme-toggle.tsx` | New client component (sun/moon pill toggle) |
| `src/app/(app)/settings/page.tsx` | Import and render `ThemeToggle` in new "Aparência" section |

## Out of Scope

- System preference detection (`prefers-color-scheme`) — keep it simple
- Per-user persistence in database — localStorage is sufficient
- Changing any other page or component
