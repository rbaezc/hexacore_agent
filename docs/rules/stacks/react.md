# React (reacthexagen)

## Slice Layout
```
src/features/<slice>/
  domain/<slice>_entity.ts              types + repository port
  application/<slice>_service.ts        framework-free use cases (testable without rendering)
  application/use_<slice>.ts            hook adapting the use case to React state
  infrastructure/<slice>_repository.ts  API / storage adapters implementing the port
  presentation/<Slice>View.tsx          components: render + events only
  index.tsx                             composition root (<SliceFeature/>)
  tests/<slice>_service.test.ts
```

## Conventions
- Business rules live in plain functions (`application/*_service.ts`), never inside components or hooks.
- Hooks receive the repository port as a parameter; components receive it via props from the composition root.
- No `fetch` calls in components; data access is an infrastructure adapter.
- Functional components only; state colocated with the feature.

## Example
### Good
```tsx
export function OrdersView({ repository }: { repository: OrdersRepository }) {
  const { entity, create } = useOrders(repository);
}
```
### Bad
```tsx
useEffect(() => { fetch('/api/orders').then(setOrders); }, []); // I/O inside presentation
```

## Quality Commands
- test: `npx vitest run --reporter=json`
- typecheck: `npx tsc --noEmit`
- lint: `npx eslint . --format json`
