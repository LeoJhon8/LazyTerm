# Build Tool Detection Patterns

This reference contains detailed patterns for detecting build tools and bundlers.

## Build Tool Identification

### Vite
- **Dependencies**: `vite`
- **Config files**: `vite.config.js`, `vite.config.ts`, `vite.config.mjs`
- **Scripts**: `vite dev`, `vite build`
- **Plugins**: Check for `@vitejs/plugin-*`

### Webpack
- **Dependencies**: `webpack`, `webpack-cli`, `webpack-dev-server`
- **Config files**: `webpack.config.js`, `webpack.config.ts`, `webpackfile.js`
- **Scripts**: `webpack serve`, `webpack build`
- **Loaders**: Check for `babel-loader`, `css-loader`, etc.

### Rollup
- **Dependencies**: `rollup`
- **Config files**: `rollup.config.js`, `rollup.config.ts`, `rollup.config.mjs`
- **Scripts**: `rollup -c`, `rollup --watch`
- **Plugins**: Check for `@rollup/plugin-*`

### Parcel
- **Dependencies**: `parcel`
- **Config files**: `.parcelrc`, `parcel.config.json`
- **Scripts**: `parcel serve`, `parcel build`
- **Features**: Zero-config detection

### esbuild
- **Dependencies**: `esbuild`
- **Config files**: `esbuild.config.js`, `build.js`, `build.ts`
- **Scripts**: `esbuild`, `esbuild serve`
- **Features**: Extremely fast builds

### Turbopack
- **Dependencies**: `@next/swc-darwin-x64`, `@next/swc-linux-x64-gnu`
- **Config files**: `next.config.js` with `turbo` option
- **Scripts**: `next dev --turbo`
- **Features**: Incremental bundling

## Configuration Analysis

### Vite Configuration
```javascript
// vite.config.js
export default {
  plugins: [vue()],
  build: {
    target: 'es2015',
    outDir: 'dist'
  }
}
```

### Webpack Configuration
```javascript
// webpack.config.js
module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  }
}
```

## Build Script Detection

Common npm scripts patterns:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "webpack serve",
    "test": "jest"
  }
}
```

## Performance Characteristics

- **Vite**: Fast development server, optimized builds
- **Webpack**: Highly configurable, plugin ecosystem
- **Rollup**: Optimized for libraries, tree-shaking
- **Parcel**: Zero configuration, fast iterations
- **esbuild**: Extremely fast, minimal configuration
- **Turbopack**: Incremental builds, Next.js integration