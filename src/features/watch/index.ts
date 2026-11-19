export * from './domain/watch_types.js';
export { compareRuns, nextStatuses, summarizeRun, keyOf } from './domain/transitions.js';
export { toAlert, detectLang, spokenFileName } from './domain/alert_text.js';
export { createIgnorePolicy } from './domain/ignore_policy.js';
export { WatchService } from './services/watch_service.js';
export type { WatchServiceDeps } from './services/watch_service.js';
export { NodeFileWatcher } from './services/fs_watcher.js';
export { ConsoleNotifier, DesktopNotifier, SpeechNotifier, createNotifiers, quietSpawn, NOTIFIER_NAMES } from './services/notifiers.js';
export type { NotifierName, QuietSpawn } from './services/notifiers.js';
