#!/usr/bin/env node

/**
 * Project Architecture Analyzer
 * Analyzes project structure and identifies technology stack, build tools, and patterns.
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

// Import modular detectors
const FrameworkDetector = require('./detectors/framework-detector');
const BuildToolDetector = require('./detectors/build-tool-detector');
const ArchitectureDetector = require('./detectors/architecture-detector');
const ReportGenerator = require('./report-generator');

class ProjectAnalyzer {
    constructor(projectPath, options = {}) {
        this.projectPath = path.resolve(projectPath);
        this.options = options;
        this.depth = options.depth || 3;
        this.excludePaths = options.excludePaths || [];
        this.result = {
            success: true,
            data: {},
            metadata: {
                analyzedAt: new Date().toISOString(),
                duration: 0
            }
        };
    }

    async analyze() {
        const startTime = Date.now();

        try {
            // Initialize detectors
            const frameworkDetector = new FrameworkDetector(this.projectPath);
            const buildToolDetector = new BuildToolDetector(this.projectPath);
            const architectureDetector = new ArchitectureDetector(this.projectPath);

            // Analyze package manager
            await this.analyzePackageManager();

            // Analyze Node.js environment
            await this.analyzeNodeEnvironment();

            // Analyze framework using detector
            this.result.data.framework = await frameworkDetector.detect();

            // Analyze build tools using detector
            this.result.data.buildTool = await buildToolDetector.detect();

            // Analyze TypeScript
            await this.analyzeTypeScript();

            // Analyze linters
            await this.analyzeLinters();

            // Analyze directory structure
            await this.analyzeDirectoryStructure();

            // Analyze architecture patterns using detector
            const detectedPatterns = await architectureDetector.detect();
            this.result.data.architecturePatterns = detectedPatterns.map(p => p.name);

        } catch (error) {
            this.result.success = false;
            this.result.error = error.message;
        }

        // Calculate duration
        this.result.metadata.duration = Date.now() - startTime;

        return this.result;
    }

    async analyzePackageManager() {
        const packageManagers = {
            pnpm: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
            yarn: ['yarn.lock'],
            npm: ['package-lock.json']
        };

        for (const [manager, files] of Object.entries(packageManagers)) {
            for (const file of files) {
                const filePath = path.join(this.projectPath, file);
                if (await this.fileExists(filePath)) {
                    const version = await this.getPackageManagerVersion(manager);
                    this.result.data.packageManager = {
                        name: manager,
                        version,
                        lockFile: file
                    };
                    return;
                }
            }
        }

        this.result.data.packageManager = null;
    }

    async analyzeNodeEnvironment() {
        const versionFiles = [
            { file: '.nvmrc', source: 'nvmrc' },
            { file: '.node-version', source: 'nodenv' },
            { file: 'package.json', source: 'engines' }
        ];

        for (const { file, source } of versionFiles) {
            const filePath = path.join(this.projectPath, file);
            if (await this.fileExists(filePath)) {
                if (file === '.nvmrc' || file === '.node-version') {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const version = content.trim();
                    this.result.data.node = {
                        version,
                        source
                    };
                    return;
                } else if (file === 'package.json') {
                    try {
                        const packageJson = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                        if (packageJson.engines && packageJson.engines.node) {
                            this.result.data.node = {
                                version: packageJson.engines.node,
                                source
                            };
                            return;
                        }
                    } catch (error) {
                        // Invalid JSON, continue
                    }
                }
            }
        }

        this.result.data.node = null;
    }

  
    async analyzeTypeScript() {
        const tsconfigPath = path.join(this.projectPath, 'tsconfig.json');
        if (!await this.fileExists(tsconfigPath)) {
            this.result.data.typescript = { enabled: false };
            return;
        }

        try {
            const tsconfig = JSON.parse(await fs.readFile(tsconfigPath, 'utf-8'));
            const packageJsonPath = path.join(this.projectPath, 'package.json');
            let packageJson = {};

            if (await this.fileExists(packageJsonPath)) {
                packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            }

            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            const strictMode = tsconfig.compilerOptions?.strict || false;
            const tsVersion = deps.typescript || 'unknown';

            // Calculate TypeScript coverage (simplified)
            const files = await this.readdirRecursive(this.projectPath);
            const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
            const jsFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.jsx') && !f.includes('node_modules'));

            const totalFiles = tsFiles.length + jsFiles.length;
            const coverage = totalFiles > 0 ? Math.round((tsFiles.length / totalFiles) * 100 * 10) / 10 : 0;

            this.result.data.typescript = {
                enabled: true,
                version: tsVersion,
                strict: strictMode,
                coverage
            };
        } catch (error) {
            this.result.data.typescript = { enabled: true, version: 'unknown', strict: false, coverage: 0 };
        }
    }

    async analyzeLinters() {
        const linters = {};

        // ESLint
        const eslintConfigs = ['.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc', 'eslint.config.js'];
        for (const config of eslintConfigs) {
            const configPath = path.join(this.projectPath, config);
            if (await this.fileExists(configPath)) {
                linters.eslint = {
                    enabled: true,
                    configFile: config
                };
                break;
            }
        }

        // Prettier
        const prettierConfigs = ['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', 'prettier.config.js'];
        for (const config of prettierConfigs) {
            const configPath = path.join(this.projectPath, config);
            if (await this.fileExists(configPath)) {
                linters.prettier = {
                    enabled: true,
                    configFile: config
                };
                break;
            }
        }

        // Stylelint
        const stylelintConfigs = ['.stylelintrc', '.stylelintrc.json', '.stylelintrc.yml', '.stylelintrc.yaml'];
        for (const config of stylelintConfigs) {
            const configPath = path.join(this.projectPath, config);
            if (await this.fileExists(configPath)) {
                linters.stylelint = {
                    enabled: true,
                    configFile: config
                };
                break;
            }
        }

        this.result.data.linters = Object.keys(linters).length > 0 ? linters : null;
    }

    async analyzeDirectoryStructure() {
        const items = await fs.readdir(this.projectPath, { withFileTypes: true });
        const keyDirs = [];

        for (const item of items) {
            if (item.isDirectory() && !this.excludePaths.includes(item.name) && !item.name.startsWith('.')) {
                keyDirs.push(`${item.name}/`);
            }
        }

        // Determine pattern
        let pattern = 'unknown';
        if (keyDirs.includes('src/')) {
            pattern = 'src-based';
        } else if (['components/', 'views/', 'pages/'].some(dir => keyDirs.includes(dir))) {
            pattern = 'feature-based';
        } else if (keyDirs.includes('lib/')) {
            pattern = 'library-based';
        }

        this.result.data.structure = {
            pattern,
            directories: keyDirs
        };
    }

    
    async getPackageManagerVersion(manager) {
        return new Promise((resolve) => {
            const process = spawn(manager, ['--version'], {
                stdio: 'pipe',
                timeout: 5000
            });

            let output = '';
            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    resolve(null);
                }
            });

            process.on('error', () => {
                resolve(null);
            });
        });
    }

    
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async readdirRecursive(dir, files = []) {
        const items = await fs.readdir(dir, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(dir, item.name);

            if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
                await this.readdirRecursive(fullPath, files);
            } else if (item.isFile()) {
                files.push(fullPath);
            }
        }

        return files;
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node analyze-project.js <project_path> [options]');
        console.error('Options can be JSON string or flags:');
        console.error('  --format <json|markdown|summary|scorecard>');
        console.error('  --output <file>');
        process.exit(1);
    }

    const projectPath = args[0];
    let options = { format: 'json' };

    // Parse command line arguments
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--format' && i + 1 < args.length) {
            options.format = args[++i];
        } else if (args[i] === '--output' && i + 1 < args.length) {
            options.outputFile = args[++i];
        } else if (args[i].startsWith('{')) {
            // JSON options string
            try {
                options = { ...options, ...JSON.parse(args[i]) };
            } catch (error) {
                console.error('Options must be valid JSON');
                process.exit(1);
            }
        }
    }

    const analyzer = new ProjectAnalyzer(projectPath, options);

    analyzer.analyze()
        .then(result => {
            // Generate report based on format
            const reportGenerator = new ReportGenerator(result, options);
            let output;

            switch (options.format) {
                case 'markdown':
                    output = reportGenerator.generate('markdown');
                    break;
                case 'summary':
                    output = reportGenerator.generate('summary');
                    break;
                case 'scorecard':
                    output = reportGenerator.generate('scorecard');
                    break;
                default:
                    output = result;
            }

            // Output
            if (options.outputFile) {
                const fs = require('fs');
                const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
                fs.writeFileSync(options.outputFile, content);
                console.log(`Report saved to ${options.outputFile}`);
            } else {
                if (typeof output === 'string') {
                    console.log(output);
                } else {
                    console.log(JSON.stringify(output, null, 2));
                }
            }
        })
        .catch(error => {
            console.error('Analysis failed:', error.message);
            process.exit(1);
        });
}

module.exports = ProjectAnalyzer;