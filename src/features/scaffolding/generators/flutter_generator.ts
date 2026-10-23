import { ProjectProfile, SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

export function flutterBlueprint(n: SliceNames, p: ProjectProfile): SliceBlueprint {
  const base = `lib/features/${n.snake}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/domain/${n.snake}_entity.dart`,
          role: 'domain',
          content: `class ${n.pascal}Entity {
  final String id;
  final DateTime createdAt;

  const ${n.pascal}Entity({required this.id, required this.createdAt});
}

/// Port implemented by the infrastructure layer.
abstract interface class ${n.pascal}Repository {
  void save(${n.pascal}Entity entity);
  ${n.pascal}Entity? findById(String id);
}
`,
        },
      ],
      application: [
        {
          path: `${base}/application/${n.snake}_service.dart`,
          role: 'application',
          content: `import '../domain/${n.snake}_entity.dart';

class ${n.pascal}Service {
  final ${n.pascal}Repository _repository;

  ${n.pascal}Service(this._repository);

  ${n.pascal}Entity create(String id) {
    if (id.isEmpty) {
      throw ArgumentError('${n.pascal}: "id" is required.');
    }
    final entity = ${n.pascal}Entity(id: id, createdAt: DateTime.now().toUtc());
    _repository.save(entity);
    return entity;
  }

  ${n.pascal}Entity? getById(String id) => _repository.findById(id);
}
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/infrastructure/in_memory_${n.snake}_repository.dart`,
          role: 'infrastructure',
          content: `import '../domain/${n.snake}_entity.dart';

class InMemory${n.pascal}Repository implements ${n.pascal}Repository {
  final Map<String, ${n.pascal}Entity> _store = {};

  @override
  void save(${n.pascal}Entity entity) => _store[entity.id] = entity;

  @override
  ${n.pascal}Entity? findById(String id) => _store[id];
}
`,
        },
      ],
      presentation: [
        {
          path: `${base}/presentation/${n.snake}_widget.dart`,
          role: 'presentation',
          content: `import 'package:flutter/widgets.dart';

import '../application/${n.snake}_service.dart';
import '../domain/${n.snake}_entity.dart';

class ${n.pascal}Widget extends StatefulWidget {
  final ${n.pascal}Service service;

  const ${n.pascal}Widget({super.key, required this.service});

  @override
  State<${n.pascal}Widget> createState() => _${n.pascal}WidgetState();
}

class _${n.pascal}WidgetState extends State<${n.pascal}Widget> {
  ${n.pascal}Entity? _entity;

  void _create() {
    setState(() => _entity = widget.service.create(DateTime.now().microsecondsSinceEpoch.toString()));
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _create,
      child: Text(_entity?.id ?? 'Create ${n.pascal}', textDirection: TextDirection.ltr),
    );
  }
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/${n.snake}_module.dart`,
        role: 'module',
        content: `import 'package:flutter/widgets.dart';

import 'application/${n.snake}_service.dart';
import 'infrastructure/in_memory_${n.snake}_repository.dart';
import 'presentation/${n.snake}_widget.dart';

/// Composition root of the ${n.snake} slice.
Widget build${n.pascal}Feature() => ${n.pascal}Widget(service: ${n.pascal}Service(InMemory${n.pascal}Repository()));
`,
      },
    ],
    tests: [
      {
        path: `test/features/${n.snake}/${n.snake}_service_test.dart`,
        role: 'test',
        content: `import 'package:flutter_test/flutter_test.dart';
import 'package:${p.dartPackage}/features/${n.snake}/application/${n.snake}_service.dart';
import 'package:${p.dartPackage}/features/${n.snake}/infrastructure/in_memory_${n.snake}_repository.dart';

void main() {
  test('creates and retrieves a ${n.snake}', () {
    final service = ${n.pascal}Service(InMemory${n.pascal}Repository());
    final created = service.create('${n.kebab}-1');
    expect(service.getById('${n.kebab}-1'), same(created));
  });

  test('rejects a missing id', () {
    final service = ${n.pascal}Service(InMemory${n.pascal}Repository());
    expect(() => service.create(''), throwsArgumentError);
  });
}
`,
      },
    ],
    notes: [],
  };
}
