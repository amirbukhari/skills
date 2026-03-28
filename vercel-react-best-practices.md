---
description: Vercel React Best Practices
---
# Vercel React Best Practices

When building React applications for Vercel, prioritize performance, edge-compatibility, and React Server Components (RSC).

## 1. Eliminate Waterfalls
Do not fetch data sequentially if the requests do not depend on each other.
**Bad**:
```tsx
const user = await getUser(id);
const posts = await getPosts(id);
```
**Good**:
```tsx
const [user, posts] = await Promise.all([getUser(id), getPosts(id)]);
```

## 2. Server-Side Data Fetching (RSC)
Always default to React Server Components for fetching data. Only use "use client" when you absolutely need interactivity (hooks, event listeners) or browser APIs.

## 3. Bundle Size Optimization
Avoid barrel imports if the library does not support optimal tree-shaking. Use absolute imports.
**Bad**: `import { Icon } from 'lucide-react'`
**Good**: `import Icon from 'lucide-react/dist/esm/icons/icon'`

## 4. Edge Runtime Compatibility
Ensure your API routes and middleware rely on standard Web APIs (Fetch, Request, Response, Crypto) rather than Node.js specific modules like `fs` or `path` whenever possible to remain compatible with Vercel Edge functions.
