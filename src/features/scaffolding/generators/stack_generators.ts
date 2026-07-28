import { GeneratedFile, ScaffoldOptions } from '../domain/scaffold_types.js';

export function generateSliceFiles(options: ScaffoldOptions): GeneratedFile[] {
  const { sliceName, stack } = options;
  const cap = sliceName.charAt(0).toUpperCase() + sliceName.slice(1);

  switch (stack) {
    case 'rust':
      return [
        { path: `src/slices/${sliceName}/mod.rs`, content: `pub struct ${cap}Slice;\nimpl ${cap}Slice {\n    pub fn execute() -> bool { true }\n}\n` },
      ];
    case 'python':
      return [
        { path: `app/slices/${sliceName}/service.py`, content: `class ${cap}Service:\n    def execute(self) -> bool:\n        return True\n` },
      ];
    case 'go':
      return [
        { path: `internal/slices/${sliceName}/${sliceName}.go`, content: `package ${sliceName}\n\ntype ${cap}Slice struct{}\n\nfunc (s *${cap}Slice) Execute() bool {\n\treturn true\n}\n` },
      ];
    case 'flutter':
      return [
        { path: `lib/features/${sliceName}/${sliceName}_widget.dart`, content: `class ${cap}Widget {}\n` },
      ];
    case 'ruby':
      return [
        { path: `app/services/${sliceName}_service.rb`, content: `class ${cap}Service\n  def call\n    true\n  end\nend\n` },
      ];
    case 'dotnet':
      return [
        { path: `Features/${cap}/${cap}Command.cs`, content: `namespace App.Features.${cap};\n\npublic record ${cap}Command(string Id);\n` },
      ];
    case 'elixir':
      return [
        { path: `lib/app/${sliceName}/${sliceName}_context.ex`, content: `defmodule App.${cap}.${cap}Context do\n  def get_${sliceName}(id), do: {:ok, %{id: id}}\nend\n` },
      ];
    case 'laravel':
      return [
        { path: `app/Actions/${cap}/${cap}Action.php`, content: `<?php\nnamespace App\\Actions\\${cap};\nclass ${cap}Action { public function execute(): bool { return true; } }\n` },
      ];
    default:
      return [
        { path: `src/features/${sliceName}/domain/${sliceName}_entity.ts`, content: `export interface ${cap}Entity { id: string; }\n` },
        { path: `src/features/${sliceName}/application/${sliceName}_handler.ts`, content: `export class ${cap}Handler { async execute() { return true; } }\n` },
      ];
  }
}
