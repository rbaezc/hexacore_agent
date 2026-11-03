/** Public API of the learning slice: other slices import from here, never from its internals. */
export * from './domain/learning_types.js';
export * from './domain/lesson_policy.js';
export * from './domain/fix_attribution.js';
export * from './services/learning_repository.js';
export * from './services/learning_service.js';
export * from './services/lesson_authoring.js';
export * from './services/lesson_finder.js';
export * from './services/lesson_library.js';
export * from './services/workspace_snapshots.js';
export * from './services/fix_attributor.js';
