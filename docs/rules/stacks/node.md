# Node.js / TypeScript (nodehexagen)

## Slice Layout
```
src/features/<slice>/
  domain/<slice>_entity.ts              entity, input types, repository port (interface)
  application/<slice>_handler.ts        use cases; depends on the port only
  infrastructure/<slice>_repository.ts  adapters implementing the port
  presentation/<slice>_routes.ts        HTTP routes calling the handler
  index.ts                              composition root (wires adapters)
  tests/<slice>_handler.test.ts
```

## Conventions
- Strict TypeScript: `strict: true`, no `any`, no non-null assertions to silence the compiler.
- ESM with NodeNext resolution: relative imports end in `.js`.
- Constructor injection of ports; no module-level singletons outside `index.ts`.
- Errors: throw typed errors from application; map them to HTTP status codes in presentation.

## Example
### Good
```ts
export class OrdersHandler {
  constructor(private readonly repository: OrdersRepository) {} // port from domain
}
```
### Bad
```ts
import { db } from '../../../db.js'; // hidden global dependency inside application
```

## Quality Commands
- test: `npx vitest run --reporter=json` (or jest `--json`)
- typecheck: `npx tsc --noEmit`
- lint: `npx eslint . --format json`
- build: `npm run build`
