# UI Conventions (Prototypes and Pages)

## Prototype Before Building
- Design a new page or screen as an HTML prototype first (`create_prototype`), show the user its preview URL, and iterate on feedback with small `edits`, one version per round.
- Use real content from the project: product names, real commands, real numbers. Never lorem ipsum.
- A prototype is one complete HTML document with its own `<style>`: `<!doctype html>`, `<html lang>`, `<meta charset>`, `<meta name="viewport" content="width=device-width, initial-scale=1">` and a `<title>` that names the page.
- Verify with `run_quality_assurance` checks `["ui"]` before showing it as done, and promote only the version the user approved (`promote_prototype`).

## Settle the Design First
- Before writing markup, decide in a few lines: who the page is for, its single job, the color tokens, the type roles and the layout idea.
- Ground choices in the subject: its vocabulary, its units, the artifacts its users know (a terminal for developer tools, a ledger for finance). Include at least one detail only this subject would have.
- Put the boldness in one place (the hero, one illustration, the type) and keep everything around it quiet.

## Color Tokens and Dark Mode
- Define every color once as a custom property on `:root` (`--bg`, `--fg`, `--muted`, `--line`, `--accent`…), with the light values.
- Redefine the same tokens for dark mode under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and again under `:root[data-theme="dark"]`, and set `color-scheme: dark` there so form controls and scrollbars follow.
- Never define a token only inside a dark block: in light mode it resolves to nothing. Never use a literal color in a component that only reads well in one theme.
- `body` always sets its own background from a token.
- Choose neutrals with a slight bias toward the accent hue instead of a pure mid-grey. Keep semantic colors (success, warning, error) separate from the accent.

## Contrast and Accessibility
- Body text needs a contrast of at least 4.5:1 against its background, large text (24px, or 18.66px bold) at least 3:1, in both themes.
- Every image has `alt` (empty for decorative images). Every button and icon link has text or `aria-label`. Every input has a `<label for>`; a placeholder is not a label.
- Keep one `<h1>` and do not skip heading levels. Give keyboard focus a visible style (`:focus-visible`).
- Respect `prefers-reduced-motion`: animation is decoration, never required to read the page.

## Layout and Mobile Width
- The page must work at 390px wide with no horizontal scroll. Keep a side gutter of at least 16px on one outer wrapper.
- Use grid or flex with `gap` for spacing between siblings instead of margins on each element.
- Give grid tracks and flex children that hold text or code `minmax(0, 1fr)` or `min-width: 0`, so long content wraps or scrolls inside them instead of pushing the page wider.
- No fixed `width` or `min-width` wider than a phone outside a media query; use `max-width` and percentages. Only code blocks, tables and diagrams may scroll sideways, each inside its own `overflow-x: auto` container.
- Size the hero to its content, not to `100vh`. Everything meant to be read is visible when the page loads, without scrolling or waiting for an animation.

## Typography
- Pair a display face used with restraint, a body face for reading, and a monospace face for code, commands and figures. Load fonts from one host with a real fallback stack.
- Set a type scale (for example 0.8125 / 1 / 1.1875 / 1.5 / 2.25 rem) and keep to it. Keep running text near 65 characters per line.
- Headings use `text-wrap: balance`; uppercase labels get a little letter spacing; numbers that line up use `font-variant-numeric: tabular-nums`.

## Copy
- Write from the user's side: name things by what people recognize, not by how the system is built.
- Use short, direct sentences and active voice. A button says what happens ("Copy", "Publish") and its confirmation says what happened ("Copied").
- Structure carries meaning: number steps only when the order matters, and use labels and dividers that say something true about the content.

## Avoid the Generic Look
- Avoid the defaults every generated page shares: a purple-to-blue gradient hero, glassmorphism cards with glows everywhere, the same radius and shadow on every block, emoji as section markers, everything centered, three identical feature cards.
- Use card styling (border, fill, shadow) only to set apart the one element that needs it.
- When the project already has a design system or brand rules, they win over everything in this document.

## Promote to the Project
- A static page target (`docs/index.html`, `public/*.html`) gets the prototype copied through a checkpoint; audit it again in place.
- A framework target (React, React Native, Flutter…) is ported, not copied: carry the tokens into the theme first (light and dark), split the page into components along its sections, keep the markup semantics, then verify with `typecheck`, `test` and `ui` against the dev server URL.
