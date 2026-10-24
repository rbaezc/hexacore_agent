/** Public API of the architecture slice: other slices import from here, never from its internals. */
export * from './domain/architecture_types.js';
export * from './services/architecture_checker.js';
export * from './services/import_extractor.js';
export * from './services/source_classifier.js';
