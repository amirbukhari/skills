---
description: Frontend Design and Consistency Guidelines
---
# Frontend Design Engineering

As an AI generating frontend code, strictly adhere to these design principles to ensure maintainability and scalability.

## 1. Token-Based Styling
Never use magic numbers or hardcode colors in individual classes. Leverage CSS variables (Custom Properties) at the `:root` level.
```css
:root {
  --color-brand-primary: #00BDB3;
  --spacing-md: 1rem;
}
```

## 2. Component Encapsulation
Styles should never bleed out of their container. Use CSS Modules, styled-components, or scoped utility classes (like Tailwind) to prevent collisions. If using raw CSS, prefix classes properly (e.g. `.RentsyncButton`).

## 3. Avoid `!important`
The use of `!important` is strictly forbidden unless overriding third-party shadow DOMs or absolutely necessary generic utilities. Fix your specificity cascade instead.

## 4. Accessibility (a11y) First
- Interactive elements must have a distinct `:focus-visible` ring.
- Ensure the color contrast ratio meets WCAG AA standards (4.5:1 for normal text).
- Use semantic HTML tags (`<nav>`, `<main>`, `<article>`, `<aside>`) instead of nested `<div>`s.
