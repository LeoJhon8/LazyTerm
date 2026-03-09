# Framework Detection Patterns

This reference contains detailed patterns for detecting frontend frameworks and meta-frameworks.

## Main Framework Detection

### Vue.js
- **Dependencies**: `vue`
- **Config files**: `vite.config.js`, `vue.config.js`
- **File patterns**: `.vue` files
- **Directory patterns**: `src/components/`, `src/views/`

### React
- **Dependencies**: `react`, `react-dom`
- **Config files**: `vite.config.js`, `next.config.js`
- **File patterns**: `.jsx`, `.tsx`
- **Directory patterns**: `src/components/`, `src/hooks/`

### Angular
- **Dependencies**: `@angular/core`, `@angular/common`
- **Config files**: `angular.json`, `tsconfig.app.json`
- **File patterns**: `.component.ts`, `.module.ts`
- **Directory patterns**: `src/app/`

### Svelte
- **Dependencies**: `svelte`
- **Config files**: `svelte.config.js`, `vite.config.js`
- **File patterns**: `.svelte`
- **Directory patterns**: `src/lib/`

### Solid.js
- **Dependencies**: `solid-js`
- **Config files**: `vite.config.js`
- **File patterns**: `.jsx`, `.tsx`
- **Directory patterns**: `src/components/`

## Meta-Framework Detection

### Nuxt.js (Vue)
- **Dependencies**: `nuxt`, `@nuxt/core`
- **Config files**: `nuxt.config.js`, `nuxt.config.ts`
- **Directory patterns**: `pages/`, `server/`, `middleware/`

### Next.js (React)
- **Dependencies**: `next`
- **Config files**: `next.config.js`, `next.config.mjs`
- **Directory patterns**: `pages/`, `app/`, `api/`

### Remix (React)
- **Dependencies**: `remix`, `@remix-run/react`
- **Config files**: `remix.config.js`
- **Directory patterns**: `app/routes/`, `app/components/`

### Gatsby (React)
- **Dependencies**: `gatsby`
- **Config files**: `gatsby.config.js`, `gatsby-node.js`
- **Directory patterns**: `gatsby-*` files

### Astro
- **Dependencies**: `astro`
- **Config files**: `astro.config.js`, `astro.config.mjs`
- **Directory patterns**: `src/pages/`, `src/layouts/`

## Version Extraction Patterns

- Extract from `package.json` dependencies
- Handle semantic versioning ranges (^, ~, >=)
- Extract major version for compatibility checks
- Handle workspace protocol (workspace:*)