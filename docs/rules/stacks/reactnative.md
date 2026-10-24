# React Native (rnhexagen)

## Slice Layout
Same as React, with `presentation/<Slice>Screen.tsx` built from `react-native` primitives (`View`, `Text`, `Pressable`).

## Conventions
- Use cases in `application/*_service.ts` stay platform-free so they run under vitest/jest without a device.
- Platform APIs (storage, camera, network) are infrastructure adapters behind ports.
- Navigation wiring belongs to the composition root, not to screens.

## Example
### Good
```tsx
export function OrdersScreen({ repository }: { repository: OrdersRepository }) { /* ... */ }
```
### Bad
```tsx
import AsyncStorage from '@react-native-async-storage/async-storage'; // used directly inside a screen
```

## Quality Commands
- test: `npx vitest run --reporter=json` or `npx jest --json`
- typecheck: `npx tsc --noEmit`
