# Flutter / Dart (flutterhexagen)

## Slice Layout
```
lib/features/<slice>/
  domain/<slice>_entity.dart                       entity + abstract interface class repository (port)
  application/<slice>_service.dart                 use cases
  infrastructure/in_memory_<slice>_repository.dart
  presentation/<slice>_widget.dart                 widgets only render and forward events
  <slice>_module.dart                              composition root (build<Slice>Feature())
test/features/<slice>/<slice>_service_test.dart
```

## Conventions
- Feature-first folders under `lib/features/`; no horizontal `lib/models` or `lib/services` folders.
- Widgets receive services through constructors (or a DI container configured in the module).
- Domain and application import nothing from `package:flutter`, so they run in plain `dart test`.
- `flutter analyze` clean.

## Example
### Good
```dart
class OrdersWidget extends StatefulWidget { final OrdersService service; }
```
### Bad
```dart
import 'package:http/http.dart' as http; // network call inside a widget
```

## Quality Commands
- test: `flutter test --reporter json`
- typecheck/lint: `flutter analyze`
