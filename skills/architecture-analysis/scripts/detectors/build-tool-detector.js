const fs = require('fs').promises;
const path = require('path');

class BuildToolDetector {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.buildTools = {
            vite: {
                dependencies: ['vite'],
                configFiles: [
                    'vite.config.js',
                    'vite.config.ts',
                    'vite.config.mjs'
                ],
                scripts: ['vite dev', 'vite build', 'vite preview']
            },
            webpack: {
                dependencies: ['webpack', 'webpack-cli', 'webpack-dev-server'],
                configFiles: [
                    'webpack.config.js',
                    'webpack.config.ts',
                    'webpackfile.js'
                ],
                scripts: ['webpack serve', 'webpack build', 'webpack-dev-server']
            },
            rollup: {
                dependencies: ['rollup'],
                configFiles: [
                    'rollup.config.js',
                    'rollup.config.ts',
                    'rollup.config.mjs'
                ],
                scripts: ['rollup -c', 'rollup --watch', 'rollup build']
            },
            parcel: {
                dependencies: ['parcel'],
                configFiles: ['.parcelrc', 'parcel.config.json'],
                scripts: ['parcel serve', 'parcel build', 'parcel']
            },
            esbuild: {
                dependencies: ['esbuild'],
                configFiles: ['esbuild.config.js', 'esbuild.js', 'build.js', 'build.ts'],
                scripts: ['esbuild', 'esbuild serve', 'esbuild build']
            },
            turbopack: {
                dependencies: ['@next/swc-darwin-x64', '@next/swc-linux-x64-gnu'],
                configFiles: ['next.config.js'],
                scripts: ['next dev --turbo'],
                indicator: 'turbo'
            }
        };
    }

    async detect() {
        const packageJson = await this.readPackageJson();
        if (!packageJson) {
            return null;
        }

        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        const scripts = packageJson.scripts || {};

        // Detect build tool
        for (const [toolName, config] of Object.entries(this.buildTools)) {
            const detection = await this.detectBuildTool(toolName, config, deps, scripts);
            if (detection) {
                return detection;
            }
        }

        return null;
    }

    async detectBuildTool(toolName, config, deps, scripts) {
        let score = 0;
        const evidence = [];

        // Check dependencies
        const foundDeps = config.dependencies.filter(dep => deps[dep]);
        if (foundDeps.length > 0) {
            score += 40;
            evidence.push(`dependencies: ${foundDeps.join(', ')}`);
        }

        // Check config files
        const configFile = await this.findConfigFile(config.configFiles);
        if (configFile) {
            score += 30;
            evidence.push(`config file: ${configFile}`);
        }

        // Check npm scripts
        const foundScripts = config.scripts.filter(script =>
            Object.values(scripts).some(pkgScript => pkgScript.includes(script))
        );
        if (foundScripts.length > 0) {
            score += 20;
            evidence.push(`scripts: ${foundScripts.join(', ')}`);
        }

        // Special indicator for turbopack
        if (config.indicator) {
            const nextConfig = await this.readNextConfig();
            if (nextConfig && nextConfig.turbo) {
                score += 30;
                evidence.push('turbo mode enabled');
            }
        }

        if (score >= 40) {
            return {
                name: toolName,
                version: deps[config.dependencies[0]] || 'unknown',
                configFile,
                confidence: Math.min(score, 100),
                evidence
            };
        }

        return null;
    }

    async findConfigFile(patterns) {
        for (const pattern of patterns) {
            const filePath = path.join(this.projectPath, pattern);
            if (await this.fileExists(filePath)) {
                return pattern;
            }
        }
        return null;
    }

    async readNextConfig() {
        const configPath = path.join(this.projectPath, 'next.config.js');
        if (!await this.fileExists(configPath)) {
            return null;
        }

        try {
            // Simple regex to detect turbo mode
            const content = await fs.readFile(configPath, 'utf-8');
            return { turbo: content.includes('turbo') };
        } catch (error) {
            return null;
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async readPackageJson() {
        try {
            const content = await fs.readFile(
                path.join(this.projectPath, 'package.json'),
                'utf-8'
            );
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }
}

module.exports = BuildToolDetector;