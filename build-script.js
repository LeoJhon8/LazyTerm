const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

console.log('Building Lazy Terminal...');

// Create dist directories
if (!fs.existsSync('dist/main')) {
  fs.mkdirSync('dist/main', { recursive: true });
}
if (!fs.existsSync('dist/renderer')) {
  fs.mkdirSync('dist/renderer', { recursive: true });
}

try {
  // Compile index.ts
  console.log('Compiling index.ts...');
  buildSync({
    entryPoints: ['src/main/index.ts'],
    bundle: false,
    outdir: 'dist/main',
    platform: 'node',
    format: 'cjs'
  });

  // Compile preload.ts
  console.log('Compiling preload.ts...');
  buildSync({
    entryPoints: ['src/main/preload.ts'],
    bundle: false,
    outdir: 'dist/main',
    platform: 'node',
    format: 'cjs'
  });

  console.log('Compiling ptyService.ts...');
  buildSync({
    entryPoints: ['src/main/ptyService.ts'],
    bundle: false,
    outdir: 'dist/main',
    platform: 'node',
    format: 'cjs'
  });

  // Compile renderer TypeScript files
  console.log('Compiling renderer TypeScript files...');

  // Common esbuild options for renderer
  const rendererOptions = {
    platform: 'browser',
    format: 'esm',
    loader: {
      '.ts': 'ts'
    },
    tsconfigRaw: {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler'
      }
    }
  };

  // Compile xtermWrapper.ts
  if (fs.existsSync('src/renderer/xtermWrapper.ts')) {
    buildSync({
      entryPoints: ['src/renderer/xtermWrapper.ts'],
      bundle: false,
      outfile: 'dist/renderer/xtermWrapper.js',
      ...rendererOptions
    });
    console.log('Compiled xtermWrapper.ts');
  }

  // Compile ui/ modules
  if (fs.existsSync('src/renderer/ui')) {
    buildSync({
      entryPoints: ['src/renderer/ui/logger.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/logger.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/tabs-utils.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/tabs-utils.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/tabs-ui.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/tabs-ui.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/history-ui.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/history-ui.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/quickcmd-ui.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/quickcmd-ui.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/session-ui.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/session-ui.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/pty-ui.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/pty-ui.js',
      ...rendererOptions
    });

    buildSync({
      entryPoints: ['src/renderer/ui/terminal-main.ts'],
      bundle: false,
      outfile: 'dist/renderer/ui/terminal-main.js',
      ...rendererOptions
    });
    console.log('Compiled ui/ modules');
  }

  console.log('TypeScript files compiled');

  // Post-process: Replace .ts extensions with .js in compiled modules
  console.log('Fixing module imports...');
  const fixImports = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const fixed = content
      .replace(/from\s+['"]\.\/([^'"]+)\.ts['"]/g, "from './$1.js'")
      .replace(/from\s+['"]\.\.\/([^'"]+)\.ts['"]/g, "from '../$1.js'")
      .replace(/from\s+['"]\.\/logger['"]/g, "from './logger.js'")
      .replace(/from\s+['"]\.\/tabs-utils['"]/g, "from './tabs-utils.js'");
    fs.writeFileSync(filePath, fixed, 'utf8');
  };

  if (fs.existsSync('dist/renderer/xtermWrapper.js')) {
    fixImports('dist/renderer/xtermWrapper.js');
  }

  if (fs.existsSync('dist/renderer/ui')) {
    const uiFiles = fs.readdirSync('dist/renderer/ui', { withFileTypes: true });
    uiFiles.forEach(file => {
      if (file.isFile() && file.name.endsWith('.js')) {
        fixImports(path.join('dist/renderer/ui', file.name));
      }
    });
    console.log('Fixed module imports');
  }
} catch (e) {
  console.error('Compilation failed:', e.message);
}

// Copy renderer files
const copyFile = (src, dest) => {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log('Copied', path.relative(__dirname, src));
  }
};

const copyDir = (src, dest) => {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
};

copyFile('src/renderer/index.html', 'dist/renderer/index.html');
copyFile('src/renderer/styles.css', 'dist/renderer/styles.css');
copyFile('src/renderer/xtermWrapper.ts', 'dist/renderer/xtermWrapper.ts');
copyFile('src/renderer/types.d.ts', 'dist/renderer/types.d.ts');

if (fs.existsSync('src/renderer/ui')) {
  copyDir('src/renderer/ui', 'dist/renderer/ui');
  console.log('Copied src/renderer/ui directory');
}

console.log('Build complete!');
