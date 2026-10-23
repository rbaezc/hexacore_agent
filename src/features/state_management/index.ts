/** Public API of the state_management slice: other slices import from here, never from its internals. */
export * from './domain/state_types.js';
export * from './domain/state_validator.js';
export * from './services/session_briefing.js';
export * from './services/state_repository.js';
