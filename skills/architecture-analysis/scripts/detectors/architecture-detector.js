const fs = require('fs').promises;
const path = require('path');

class ArchitectureDetector {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.patterns = {
            monorepo: {
                indicators: [
                    { type: 'file', patterns: ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'rush.json'] },
                    { type: 'directory', patterns: ['packages', 'apps', 'libs'] },
                    { type: 'config', check: (packageJson) => packageJson.workspaces }
                ],
                weight: 30
            },
            microservices: {
                indicators: [
                    { type: 'directory', patterns: ['services', 'microservices'] },
                    { type: 'pattern', check: async (items) =>
                        items.some(item =>
                            item.isDirectory() &&
                            (item.name.startsWith('service-') || item.name.endsWith('-service'))
                        )
                    }
                ],
                weight: 30
            },
            modular: {
                indicators: [
                    { type: 'directory', patterns: ['src/features', 'src/modules', 'features', 'modules'] },
                    { type: 'count', check: async (srcPath) => {
                        try {
                            const items = await fs.readdir(srcPath, { withFileTypes: true });
                            const modules = items.filter(item =>
                                item.isDirectory() &&
                                !item.name.startsWith('.') &&
                                !['components', 'utils', 'assets', 'styles'].includes(item.name)
                            );
                            return modules.length >= 3;
                        } catch {
                            return false;
                        }
                    }}
                ],
                weight: 25
            },
            layered: {
                indicators: [
                    { type: 'directory', patterns: ['controllers', 'services', 'models', 'repositories'] },
                    { type: 'count', check: async (basePath) => {
                        const layerPatterns = ['controllers', 'services', 'models', 'repositories'];
                        let count = 0;
                        for (const pattern of layerPatterns) {
                            if (await this.fileExists(path.join(basePath, pattern))) {
                                count++;
                            }
                        }
                        return count >= 2;
                    }}
                ],
                weight: 25
            },
            eventDriven: {
                indicators: [
                    { type: 'directory', patterns: ['events', 'handlers', 'event-sourcing'] },
                    { type: 'dependency', patterns: ['eventemitter', '@azure/service-bus', 'amqplib'] }
                ],
                weight: 20
            },
            cleanArchitecture: {
                indicators: [
                    { type: 'directory', patterns: ['domain', 'usecases', 'application', 'interfaces'] },
                    { type: 'structure', check: async () => {
                        const requiredDirs = ['domain', 'usecases', 'application'];
                        const srcPath = path.join(this.projectPath, 'src');
                        if (!await this.fileExists(srcPath)) return false;

                        const items = await fs.readdir(srcPath);
                        const foundDirs = requiredDirs.filter(dir => items.includes(dir));
                        return foundDirs.length >= 2;
                    }}
                ],
                weight: 25
            }
        };
    }

    async detect() {
        const packageJson = await this.readPackageJson();
        const items = await fs.readdir(this.projectPath, { withFileTypes: true });
        const detectedPatterns = [];

        for (const [patternName, config] of Object.entries(this.patterns)) {
            const confidence = await this.detectPattern(patternName, config, packageJson, items);
            if (confidence >= 50) {
                detectedPatterns.push({
                    name: patternName,
                    confidence,
                    weight: config.weight
                });
            }
        }

        // Sort by confidence and weight
        detectedPatterns.sort((a, b) => (b.confidence + b.weight) - (a.confidence + a.weight));

        return detectedPatterns;
    }

    async detectPattern(patternName, config, packageJson, items) {
        let totalScore = 0;
        let maxScore = 0;

        for (const indicator of config.indicators) {
            maxScore += 100;

            switch (indicator.type) {
                case 'file':
                    if (await this.checkFiles(indicator.patterns)) {
                        totalScore += 100;
                    }
                    break;

                case 'directory':
                    if (await this.checkDirectories(indicator.patterns)) {
                        totalScore += 100;
                    }
                    break;

                case 'pattern':
                    if (await indicator.check(items)) {
                        totalScore += 100;
                    }
                    break;

                case 'config':
                    if (packageJson && indicator.check(packageJson)) {
                        totalScore += 100;
                    }
                    break;

                case 'count':
                    const basePath = path.join(this.projectPath, 'src');
                    if (await indicator.check(basePath)) {
                        totalScore += 100;
                    }
                    break;

                case 'dependency':
                    if (packageJson && await this.checkDependencies(packageJson, indicator.patterns)) {
                        totalScore += 100;
                    }
                    break;

                case 'structure':
                    if (await indicator.check()) {
                        totalScore += 100;
                    }
                    break;
            }
        }

        return maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    }

    async checkFiles(patterns) {
        for (const pattern of patterns) {
            const filePath = path.join(this.projectPath, pattern);
            if (await this.fileExists(filePath)) {
                return true;
            }
        }
        return false;
    }

    async checkDirectories(patterns) {
        for (const pattern of patterns) {
            const dirPath = path.join(this.projectPath, pattern);
            if (await this.fileExists(dirPath)) {
                return true;
            }
        }
        return false;
    }

    async checkDependencies(packageJson, patterns) {
        const deps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies
        };
        return patterns.some(dep => deps[dep]);
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

module.exports = ArchitectureDetector;