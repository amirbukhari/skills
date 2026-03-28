---
description: Elite UI/UX Pro Max Guidelines
---
# UI/UX Pro Max Guidelines

When asked to implement UI/UX, you must act as the greatest product designer in the world. 
Do not settle for "good enough." Aim for absolute perfection in micro-interactions, layout, and visual hierarchy.

## 1. Typography and Rhythm
- Use a rigid 8pt or 4pt grid system.
- Always implement `-webkit-font-smoothing: antialiased` and `text-rendering: optimizeLegibility`.
- Pay attention to line-heights. Text should breathe (e.g., `1.6` for paragraphs, `1.1` for massive headers).

## 2. The Power of Micro-Interactions
- Avoid instantaneous state changes. Use `cubic-bezier` transitions for hover states.
- When lists appear, stagger their entrance using `animation-delay`.
- Active states should feel tactile (e.g., a glowing 3px accent line) rather than flat backgrounds.

## 3. Shadows and Depth (Glassmorphism + Linear-style)
- Do not use single-layer drop shadows (`box-shadow: 0 4px 6px rgba(0,0,0,0.1)`).
- Use multi-layered, smooth drop shadows to simulate real lighting:
  `box-shadow: 0 4px 12px -4px rgba(0,0,0,0.05), 0 24px 64px -12px rgba(0,0,0,0.1);`
- Incorporate subtle glassmorphism (`backdrop-filter: blur(10px)`) over gradients.

## 4. Dynamic Empty States
Never show a blank screen or a single unstyled icon. Empty states must be an opportunity to delight. Use floating CSS gradient orbs or custom SVG illustrations to guide the user.
