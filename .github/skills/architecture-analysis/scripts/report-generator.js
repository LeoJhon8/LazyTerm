class ReportGenerator {
    constructor(analysisResult, options = {}) {
        this.result = analysisResult;
        this.options = options;
    }

    generate(format = 'json') {
        switch (format) {
            case 'markdown':
                return this.generateMarkdown();
            case 'summary':
                return this.generateSummary();
            case 'scorecard':
                return this.generateScorecard();
            case 'diagram':
                return this.generateDiagram();
            default:
                return this.result;
        }
    }

    generateMarkdown() {
        const { data } = this.result;
        const sections = [];

        // Header
        sections.push('# Architecture Analysis Report\n');

        // Project Overview
        sections.push('## Project Overview');
        const overview = this.generateOverview();
        sections.push(overview);

        // Technology Stack
        if (data.framework || data.buildTool) {
            sections.push('\n## Technology Stack');
            sections.push(this.generateTechStack());
        }

        // Architecture
        if (data.architecturePatterns || data.structure) {
            sections.push('\n## Architecture');
            sections.push(this.generateArchitectureSection());
        }

        // Quality Metrics
        sections.push('\n## Quality Metrics');
        sections.push(this.generateQualityMetrics());

        // Recommendations
        sections.push('\n## Recommendations');
        sections.push(this.generateRecommendations());

        return sections.join('\n');
    }

    generateOverview() {
        const { data } = this.result;
        const parts = [];

        if (data.framework) {
            const framework = data.framework.metaFramework
                ? `${data.framework.name} + ${data.framework.metaFramework}`
                : data.framework.name;
            parts.push(`**Type**: ${framework} application`);
        }

        parts.push(`**Package Manager**: ${data.packageManager?.name || 'Unknown'}`);
        parts.push(`**Node.js**: ${data.node?.version || 'Not specified'}`);

        if (data.typescript?.enabled) {
            parts.push(`**TypeScript**: ${data.typescript.coverage}% coverage`);
        }

        return parts.join('\n- ') + '\n';
    }

    generateTechStack() {
        const { data } = this.result;
        const items = [];

        if (data.framework) {
            items.push(`- **Framework**: ${data.framework.name} v${data.framework.version}`);
            if (data.framework.metaFramework) {
                items.push(`- **Meta-framework**: ${data.framework.metaFramework}`);
            }
        }

        if (data.buildTool) {
            items.push(`- **Build Tool**: ${data.buildTool.name} v${data.buildTool.version}`);
        }

        if (data.packageManager) {
            items.push(`- **Package Manager**: ${data.packageManager.name} v${data.packageManager.version}`);
        }

        return items.join('\n');
    }

    generateArchitectureSection() {
        const { data } = this.result;
        const items = [];

        if (data.architecturePatterns && data.architecturePatterns.length > 0) {
            items.push(`**Patterns**: ${data.architecturePatterns.join(', ')}`);
        }

        if (data.structure) {
            items.push(`**Structure**: ${data.structure.pattern}`);
            if (data.structure.directories.length > 0) {
                items.push(`**Key directories**: ${data.structure.directories.slice(0, 5).join(', ')}`);
            }
        }

        return items.join('\n- ');
    }

    generateQualityMetrics() {
        const { data } = this.result;
        const metrics = [];

        // TypeScript
        if (data.typescript) {
            const tsEmoji = data.typescript.coverage > 80 ? '✅' :
                           data.typescript.coverage > 50 ? '⚠️' : '❌';
            metrics.push(`${tsEmoji} TypeScript: ${data.typescript.coverage}% coverage`);
        }

        // Linters
        if (data.linters) {
            const linterItems = [];
            if (data.linters.eslint) linterItems.push('ESLint');
            if (data.linters.prettier) linterItems.push('Prettier');
            if (data.linters.stylelint) linterItems.push('Stylelint');

            const linterEmoji = linterItems.length > 0 ? '✅' : '❌';
            metrics.push(`${linterEmoji} Code quality: ${linterItems.length > 0 ? linterItems.join(', ') : 'Not configured'}`);
        }

        return metrics.map(m => `- ${m}`).join('\n');
    }

    generateRecommendations() {
        const recommendations = [];
        const { data } = this.result;

        // TypeScript recommendations
        if (!data.typescript?.enabled) {
            recommendations.push('1. Consider adopting TypeScript for better type safety');
        } else if (data.typescript.coverage < 80) {
            recommendations.push(`1. Increase TypeScript coverage (currently ${data.typescript.coverage}%)`);
        }

        // Linter recommendations
        if (!data.linters) {
            recommendations.push('2. Set up ESLint and Prettier for code quality');
        } else if (!data.linters.eslint) {
            recommendations.push('2. Add ESLint for linting');
        }

        // Testing recommendations
        recommendations.push('3. Implement automated testing strategy');

        // Architecture recommendations
        if (data.architecturePatterns && data.architecturePatterns.includes('monorepo')) {
            recommendations.push('4. Consider implementing shared component library');
        }

        if (recommendations.length === 0) {
            recommendations.push('Project follows good practices! Consider documentation improvements.');
        }

        return recommendations;
    }

    generateSummary() {
        const { data } = this.result;
        const score = this.calculateOverallScore();

        return {
            projectType: this.getProjectType(),
            complexity: this.assessComplexity(),
            maintainability: this.assessMaintainability(),
            overallScore: score,
            keyMetrics: {
                framework: data.framework?.name || 'Unknown',
                typescript: data.typescript?.enabled ? `${data.typescript.coverage}%` : 'No',
                hasLinting: !!data.linters,
                architecture: data.architecturePatterns?.[0] || 'Unknown'
            }
        };
    }

    generateScorecard() {
        const categories = {
            technology: this.assessTechnology(),
            architecture: this.assessArchitectureScore(),
            quality: this.assessQuality(),
            maintainability: this.assessMaintainabilityScore()
        };

        const overallScore = Object.values(categories).reduce((a, b) => a + b.score, 0) / Object.keys(categories).length;

        return {
            overallScore: Math.round(overallScore),
            categories,
            recommendations: this.generateRecommendations()
        };
    }

    generateDiagram() {
        const { data } = this.result;
        const elements = [];

        // Framework node
        if (data.framework) {
            elements.push(`    ${data.framework.name}[${data.framework.name}]`);
        }

        // Build tool node
        if (data.buildTool) {
            elements.push(`    ${data.buildTool.name}[${data.buildTool.name}]`);
        }

        // Package manager node
        if (data.packageManager) {
            elements.push(`    ${data.packageManager.name}[${data.packageManager.name}]`);
        }

        // Generate Mermaid diagram
        return `graph TB
${elements.join('\n')}
    subgraph "Quality"
        TS${data.typescript?.enabled ? '[✅ TypeScript]' : '[❌ No TypeScript]'}
        Lint${data.linters ? '[✅ Linters]' : '[❌ No Linters]'}
    end`;
    }

    calculateOverallScore() {
        const scores = [
            this.assessTechnologyScore(),
            this.assessArchitectureScore(),
            this.assessQualityScore(),
            this.assessMaintainabilityScore()
        ];
        return Math.round(scores.reduce((a, b) => a + b) / scores.length);
    }

    getProjectType() {
        const { data } = this.result;
        if (!data.framework) return 'unknown';

        const base = data.framework.name;
        const meta = data.framework.metaFramework;
        return meta ? `${base}-${meta}` : base;
    }

    assessComplexity() {
        const { data } = this.result;
        let score = 0;

        if (data.framework?.metaFramework) score += 2;
        if (data.architecturePatterns?.includes('monorepo')) score += 2;
        if (data.architecturePatterns?.includes('microservices')) score += 3;
        if (data.buildTool?.name === 'webpack') score += 1;

        if (score <= 2) return 'low';
        if (score <= 4) return 'medium';
        return 'high';
    }

    assessMaintainability() {
        const score = this.calculateOverallScore();
        if (score >= 80) return 'excellent';
        if (score >= 60) return 'good';
        if (score >= 40) return 'fair';
        return 'poor';
    }

    assessTechnology() {
        return {
            score: this.assessTechnologyScore(),
            details: this.getTechnologyDetails()
        };
    }

    assessTechnologyScore() {
        const { data } = this.result;
        let score = 50;

        if (data.framework) score += 20;
        if (data.buildTool) score += 15;
        if (data.packageManager) score += 10;
        if (data.typescript?.enabled) score += 5;

        return Math.min(score, 100);
    }

    assessArchitecture() {
        return {
            score: this.assessArchitectureScore(),
            details: this.getArchitectureDetails()
        };
    }

    assessArchitectureScore() {
        const { data } = this.result;
        let score = 50;

        if (data.architecturePatterns?.length > 0) score += 20;
        if (data.structure?.pattern !== 'unknown') score += 15;
        if (data.architecturePatterns?.includes('modular')) score += 10;
        if (data.architecturePatterns?.includes('layered')) score += 5;

        return Math.min(score, 100);
    }

    assessQuality() {
        return {
            score: this.assessQualityScore(),
            details: this.getQualityDetails()
        };
    }

    assessQualityScore() {
        const { data } = this.result;
        let score = 50;

        if (data.linters) score += 25;
        if (data.typescript?.enabled) {
            score += 25;
            if (data.typescript.coverage > 80) score += 10;
            else if (data.typescript.coverage > 50) score += 5;
        }

        return Math.min(score, 100);
    }

    assessMaintainabilityScore() {
        const scores = [
            this.assessTechnologyScore(),
            this.assessArchitectureScore(),
            this.assessQualityScore()
        ];
        return Math.round(scores.reduce((a, b) => a + b) / scores.length);
    }

    getTechnologyDetails() {
        const { data } = this.result;
        const details = [];

        if (data.framework) details.push(`Uses ${data.framework.name}`);
        if (data.typescript?.enabled) details.push('TypeScript enabled');
        if (data.linters) details.push('Code quality tools configured');

        return details.join(', ');
    }

    getArchitectureDetails() {
        const { data } = this.result;
        const details = [];

        if (data.architecturePatterns?.length > 0) {
            details.push(`Patterns: ${data.architecturePatterns.join(', ')}`);
        }
        if (data.structure?.pattern) {
            details.push(`Structure: ${data.structure.pattern}`);
        }

        return details.join(', ');
    }

    getQualityDetails() {
        const { data } = this.result;
        const details = [];

        if (data.linters) details.push('Linting configured');
        if (data.typescript?.enabled) {
            details.push(`TypeScript ${data.typescript.coverage}% coverage`);
        }

        return details.join(', ') || 'No quality tools detected';
    }
}

module.exports = ReportGenerator;