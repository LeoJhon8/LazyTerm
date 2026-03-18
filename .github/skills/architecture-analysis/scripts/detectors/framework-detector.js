const fs = require('fs').promises;
const path = require('path');

class FrameworkDetector {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.frameworks = {
            vue: {
                dependencies: ['vue'],
                metaFrameworks: {
                    nuxt: ['nuxt', '@nuxt/core']
                },
                configFilePatterns: ['vue.config.js', 'vite.config.js'],
                filePatterns: ['.vue'],
                dirPatterns: ['src/components', 'src/views']
            },
            react: {
                dependencies: ['react', 'react-dom'],
                metaFrameworks: {
                    next: ['next'],
                    remix: ['remix', '@remix-run/react'],
                    gatsby: ['gatsby']
                },
                configFilePatterns: ['vite.config.js', 'next.config.js'],
                filePatterns: ['.jsx', '.tsx'],
                dirPatterns: ['src/components', 'src/hooks']
            },
            angular: {
                dependencies: ['@angular/core', '@angular/common'],
                metaFrameworks: {},
                configFilePatterns: ['angular.json', 'tsconfig.app.json'],
                filePatterns: ['.component.ts', '.module.ts'],
                dirPatterns: ['src/app']
            },
            svelte: {
                dependencies: ['svelte'],
                metaFrameworks: {
                    sveltekit: ['@sveltejs/kit']
                },
                configFilePatterns: ['svelte.config.js', 'vite.config.js'],
                filePatterns: ['.svelte'],
                dirPatterns: ['src/lib', 'src/routes']
            },
            solid: {
                dependencies: ['solid-js'],
                metaFrameworks: {},
                configFilePatterns: ['vite.config.js'],
                filePatterns: ['.jsx', '.tsx'],
                dirPatterns: ['src/components']
            }
        };
    }

    async detect() {
        const packageJson = await this.readPackageJson();
        if (!packageJson) {
            return null;
        }

        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        // Detect main framework
        const framework = this.detectFramework(deps);
        if (!framework) {
            return null;
        }

        // Detect meta-framework
        const metaFramework = this.detectMetaFramework(framework.name, deps);

        // Get additional info
        const version = deps[this.frameworks[framework.name].dependencies[0]];
        const major = this.extractMajorVersion(version);

        return {
            name: framework.name,
            version,
            major,
            metaFramework,
            confidence: this.calculateConfidence(framework, metaFramework, deps)
        };
    }

    detectFramework(deps) {
        for (const [frameworkName, config] of Object.entries(this.frameworks)) {
            if (config.dependencies.some(dep => deps[dep])) {
                return {
                    name: frameworkName,
                    config
                };
            }
        }
        return null;
    }

    detectMetaFramework(frameworkName, deps) {
        const metaFrameworks = this.frameworks[frameworkName].metaFrameworks;

        for (const [metaName, packages] of Object.entries(metaFrameworks)) {
            if (packages.some(pkg => deps[pkg])) {
                return metaName;
            }
        }

        return null;
    }

    calculateConfidence(framework, metaFramework, deps) {
        let confidence = 50; // Base confidence

        // Main dependency found
        confidence += 20;

        // Meta-framework detected
        if (metaFramework) {
            confidence += 20;
        }

        // Additional framework-specific dependencies
        const frameworkConfig = this.frameworks[framework.name];
        const frameworkDeps = frameworkConfig.dependencies.filter(d => deps[d]);
        confidence += frameworkDeps.length * 5;

        return Math.min(confidence, 100);
    }

    extractMajorVersion(version) {
        const match = version.replace(/^[\^~<>=]+/, '').match(/^(\d+)/);
        return match ? parseInt(match[1]) : null;
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

module.exports = FrameworkDetector;