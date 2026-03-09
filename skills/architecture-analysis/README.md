# Frontend Architecture Analyzer

An advanced skill for analyzing frontend project architecture with modular detection and multiple output formats.

## Features

- **Modular Detection**: Separate detectors for frameworks, build tools, and architecture patterns
- **Multiple Output Formats**: JSON, Markdown, Executive Summary, Scorecard
- **Comprehensive Analysis**: Detects frameworks, build tools, package managers, linters, and architecture patterns
- **Recommendations Engine**: Provides actionable improvement suggestions
- **CLI Interface**: Easy-to-use command-line tool with multiple options

## Installation

The skill is ready to use as part of the fe-analysis-skills plugin.

## Usage

### Basic Analysis

```bash
node scripts/analyze-project.js /path/to/project
```

### Generate Markdown Report

```bash
node scripts/analyze-project.js /path/to/project --format markdown --output report.md
```

### Generate Executive Summary

```bash
node scripts/analyze-project.js /path/to/project --format summary
```

### Generate Scorecard

```bash
node scripts/analyze-project.js /path/to/project --format scorecard
```

### Programmatic Usage

```javascript
const ProjectAnalyzer = require('./scripts/analyze-project');

const analyzer = new ProjectAnalyzer('./my-project');
const result = await analyzer.analyze();

// Generate different report formats
const ReportGenerator = require('./scripts/report-generator');
const reportGen = new ReportGenerator(result);

const markdown = reportGen.generate('markdown');
const summary = reportGen.generate('summary');
const scorecard = reportGen.generate('scorecard');
```

## Architecture

```
skills/analyzing-architecture/
├── SKILL.md                    # Main skill documentation
├── README.md                   # This file
├── package.json               # Skill metadata
└── scripts/
    ├── analyze-project.js     # Main analyzer script
    ├── report-generator.js    # Report generation logic
    └── detectors/
        ├── framework-detector.js     # Framework detection
        ├── build-tool-detector.js    # Build tool detection
        └── architecture-detector.js  # Architecture pattern detection
└── references/
    ├── framework-patterns.md         # Framework detection patterns
    ├── build-tool-patterns.md        # Build tool patterns
    ├── architecture-patterns.md      # Architecture patterns
    └── output-formats.md             # Output format examples
```

## What's New

### v2.0 Optimizations

- **Modular Architecture**: Split detection logic into specialized modules
- **Progressive Disclosure**: Moved detailed docs to reference files
- **Multiple Output Formats**: Added Markdown, Summary, and Scorecard outputs
- **Enhanced Detection**: Improved pattern recognition with confidence scoring
- **Better CLI**: Added flags for format and output options
- **Recommendations Engine**: Provides actionable improvement suggestions

### Key Improvements

1. **Maintainability**: Modular code structure for easier updates
2. **Extensibility**: Easy to add new detectors and output formats
3. **Performance**: Optimized file operations and parallel processing
4. **User Experience**: Clearer output formats and CLI options
5. **Documentation**: Comprehensive reference materials

## Detected Technologies

### Frameworks
- Vue.js (with Nuxt.js)
- React (with Next.js, Remix, Gatsby)
- Angular
- Svelte (with SvelteKit)
- Solid.js

### Build Tools
- Vite
- Webpack
- Rollup
- Parcel
- esbuild
- Turbopack

### Architecture Patterns
- Monorepo (pnpm, Lerna, Nx)
- Microservices
- Modular architecture
- Layered architecture
- Event-driven architecture
- Clean architecture

## Contributing

To add support for new technologies:

1. Create a new detector in `scripts/detectors/`
2. Add patterns to `references/`
3. Update the main analyzer to use the new detector
4. Add tests for the new functionality

## License

MIT