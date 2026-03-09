# Architecture Pattern Recognition

This reference contains detailed patterns for recognizing architectural patterns in projects.

## Monorepo Detection

### Indicators
- **Workspace files**: `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, `rush.json`
- **Tools**: Lerna, Nx, Rush, Turborepo
- **Directory structure**: `packages/`, `apps/`, `libs/`
- **Shared dependencies**: Root-level `package.json` with workspaces

### Configuration Examples

#### pnpm Workspace
```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

#### Lerna Configuration
```json
{
  "version": "independent",
  "npmClient": "pnpm",
  "useWorkspaces": true
}
```

#### Nx Configuration
```json
{
  "extends": "@nx/workspace/presets/npm.json",
  "targetDefaults": {
    "build": {
      "cache": true
    }
  }
}
```

## Microservices Detection

### Indicators
- **Directory naming**: `service-*`, `*-service`, `microservices/`
- **API Gateway**: `api-gateway/`, `gateway/`
- **Service discovery**: Consul, Eureka configurations
- **Containerization**: Multiple `Dockerfile`s, `docker-compose.yml`

### Directory Structure
```
├── services/
│   ├── user-service/
│   ├── product-service/
│   └── order-service/
├── api-gateway/
└── shared/
```

## Modular Architecture

### Indicators
- **Feature modules**: `src/features/`, `src/modules/`
- **Shared modules**: `src/shared/`, `src/common/`
- **Module boundaries**: Clear separation of concerns
- **Dependency injection**: DI container configurations

### Module Structure
```
src/
├── features/
│   ├── auth/
│   │   ├── components/
│   │   ├── services/
│   │   └── types/
│   └── dashboard/
├── shared/
│   ├── components/
│   ├── utils/
│   └── types/
```

## Layered Architecture

### Indicators
- **Controller layer**: `controllers/`, `api/`
- **Service layer**: `services/`, `business/`
- **Data layer**: `models/`, `repositories/`, `dal/`
- **Utilities**: `utils/`, `helpers/`

### Layer Structure
```
src/
├── controllers/     # HTTP handlers, route handlers
├── services/        # Business logic
├── repositories/    # Data access
├── models/          # Data models
└── utils/           # Utilities
```

## Event-Driven Architecture

### Indicators
- **Event handlers**: `events/`, `handlers/`
- **Event sourcing**: Event store configurations
- **Message queues**: RabbitMQ, Kafka, AWS SQS configurations
- **Pub/Sub**: Publisher/subscriber patterns

## Clean Architecture

### Indicators
- **Entities**: `domain/entities/`
- **Use cases**: `usecases/`, `application/`
- **Interface adapters**: `interfaces/`, `adapters/`
- **Frameworks**: `frameworks/`, `infrastructure/`

## Pattern Confidence Scoring

### High Confidence (90%+)
- Explicit configuration files present
- Multiple consistent indicators
- Clear directory structure

### Medium Confidence (70-90%)
- Some indicators present
- Partial directory structure
- Configuration hints

### Low Confidence (50-70%)
- Single indicators
- Ambiguous structure
- Indirect evidence

## Pattern Combinations

Projects often combine multiple patterns:
- **Monorepo + Modular**: Multiple modules in a single repository
- **Microservices + Event-Driven**: Services communicating via events
- **Layered + Modular**: Layers organized into modules