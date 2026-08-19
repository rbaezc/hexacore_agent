import { GeneratedFile, ScaffoldOptions } from '../domain/scaffold_types.js';

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation';
type LayerFiles = Record<Layer, GeneratedFile>;

function nodeLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `src/features/${s}/domain/${s}_entity.ts`,
      content: `export interface ${cap}Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Create${cap}Input {
  id: string;
}
`,
    },
    application: {
      path: `src/features/${s}/application/${s}_handler.ts`,
      content: `import { ${cap}Entity, Create${cap}Input } from '../domain/${s}_entity.js';
import { ${cap}Repository } from '../infrastructure/${s}_repository.js';

export class ${cap}Handler {
  constructor(private readonly repository: ${cap}Repository) {}

  async create(input: Create${cap}Input): Promise<${cap}Entity> {
    if (!input.id) {
      throw new Error('${cap}: "id" is required.');
    }
    const now = new Date().toISOString();
    const entity: ${cap}Entity = { id: input.id, createdAt: now, updatedAt: now };
    await this.repository.save(entity);
    return entity;
  }

  async getById(id: string): Promise<${cap}Entity | undefined> {
    return this.repository.findById(id);
  }
}
`,
    },
    infrastructure: {
      path: `src/features/${s}/infrastructure/${s}_repository.ts`,
      content: `import { ${cap}Entity } from '../domain/${s}_entity.js';

export class ${cap}Repository {
  private readonly store = new Map<string, ${cap}Entity>();

  async save(entity: ${cap}Entity): Promise<void> {
    this.store.set(entity.id, entity);
  }

  async findById(id: string): Promise<${cap}Entity | undefined> {
    return this.store.get(id);
  }
}
`,
    },
    presentation: {
      path: `src/features/${s}/presentation/${s}_routes.ts`,
      content: `import { ${cap}Handler } from '../application/${s}_handler.js';

export function register${cap}Routes(handler: ${cap}Handler) {
  return {
    'POST /${s}': (body: { id: string }) => handler.create(body),
    'GET /${s}/:id': (id: string) => handler.getById(id),
  };
}
`,
    },
  };
}

function reactLikeLayers(s: string, cap: string, native: boolean): LayerFiles {
  const presentationPath = native
    ? `src/features/${s}/presentation/${cap}Screen.tsx`
    : `src/features/${s}/presentation/${cap}View.tsx`;

  const presentationContent = native
    ? `import { Pressable, Text, View } from 'react-native';
import { use${cap} } from '../application/use_${s}.js';

export function ${cap}Screen() {
  const { entity, create } = use${cap}();

  return (
    <View>
      <Pressable onPress={() => create(String(Date.now()))}>
        <Text>Create ${cap}</Text>
      </Pressable>
      {entity && <Text>{entity.id}</Text>}
    </View>
  );
}
`
    : `import { use${cap} } from '../application/use_${s}.js';

export function ${cap}View() {
  const { entity, create } = use${cap}();

  return (
    <div>
      <button onClick={() => create(String(Date.now()))}>Create ${cap}</button>
      {entity && <p>{entity.id}</p>}
    </div>
  );
}
`;

  return {
    domain: {
      path: `src/features/${s}/domain/${s}_types.ts`,
      content: `export interface ${cap}Entity {
  id: string;
  createdAt: string;
}
`,
    },
    infrastructure: {
      path: `src/features/${s}/infrastructure/${s}_repository.ts`,
      content: `import { ${cap}Entity } from '../domain/${s}_types.js';

const store = new Map<string, ${cap}Entity>();

export const ${cap}Repository = {
  save(entity: ${cap}Entity): void {
    store.set(entity.id, entity);
  },
  findById(id: string): ${cap}Entity | undefined {
    return store.get(id);
  },
};
`,
    },
    application: {
      path: `src/features/${s}/application/use_${s}.ts`,
      content: `import { useState, useCallback } from 'react';
import { ${cap}Entity } from '../domain/${s}_types.js';
import { ${cap}Repository } from '../infrastructure/${s}_repository.js';

export function use${cap}() {
  const [entity, setEntity] = useState<${cap}Entity | undefined>(undefined);

  const create = useCallback((id: string) => {
    if (!id) {
      throw new Error('${cap}: "id" is required.');
    }
    const created: ${cap}Entity = { id, createdAt: new Date().toISOString() };
    ${cap}Repository.save(created);
    setEntity(created);
    return created;
  }, []);

  return { entity, create };
}
`,
    },
    presentation: {
      path: presentationPath,
      content: presentationContent,
    },
  };
}

function dotnetLayers(cap: string): LayerFiles {
  return {
    domain: {
      path: `Features/${cap}/${cap}Entity.cs`,
      content: `namespace App.Features.${cap};

public class ${cap}Entity
{
    public string Id { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
`,
    },
    application: {
      path: `Features/${cap}/${cap}Handler.cs`,
      content: `namespace App.Features.${cap};

public record ${cap}Command(string Id);

public class ${cap}Handler
{
    private readonly I${cap}Repository _repository;

    public ${cap}Handler(I${cap}Repository repository)
    {
        _repository = repository;
    }

    public async Task<${cap}Entity> HandleAsync(${cap}Command command)
    {
        if (string.IsNullOrWhiteSpace(command.Id))
        {
            throw new ArgumentException("${cap}: \\"Id\\" is required.");
        }

        var entity = new ${cap}Entity
        {
            Id = command.Id,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        await _repository.SaveAsync(entity);
        return entity;
    }
}
`,
    },
    infrastructure: {
      path: `Features/${cap}/${cap}Repository.cs`,
      content: `namespace App.Features.${cap};

public interface I${cap}Repository
{
    Task SaveAsync(${cap}Entity entity);
    Task<${cap}Entity?> FindByIdAsync(string id);
}

public class ${cap}Repository : I${cap}Repository
{
    private readonly Dictionary<string, ${cap}Entity> _store = new();

    public Task SaveAsync(${cap}Entity entity)
    {
        _store[entity.Id] = entity;
        return Task.CompletedTask;
    }

    public Task<${cap}Entity?> FindByIdAsync(string id)
    {
        _store.TryGetValue(id, out var entity);
        return Task.FromResult(entity);
    }
}
`,
    },
    presentation: {
      path: `Features/${cap}/${cap}Controller.cs`,
      content: `using Microsoft.AspNetCore.Mvc;

namespace App.Features.${cap};

[ApiController]
[Route("api/[controller]")]
public class ${cap}Controller : ControllerBase
{
    private readonly ${cap}Handler _handler;

    public ${cap}Controller(${cap}Handler handler)
    {
        _handler = handler;
    }

    [HttpPost]
    public async Task<ActionResult<${cap}Entity>> Create(${cap}Command command)
    {
        var entity = await _handler.HandleAsync(command);
        return Ok(entity);
    }
}
`,
    },
  };
}

function laravelLayers(cap: string): LayerFiles {
  return {
    domain: {
      path: `app/DataTransferObjects/${cap}Data.php`,
      content: `<?php

namespace App\\DataTransferObjects;

class ${cap}Data
{
    public function __construct(
        public readonly string $id,
        public readonly string $createdAt
    ) {
    }
}
`,
    },
    application: {
      path: `app/Actions/${cap}/${cap}Action.php`,
      content: `<?php

namespace App\\Actions\\${cap};

use App\\DataTransferObjects\\${cap}Data;
use App\\Repositories\\${cap}Repository;

class ${cap}Action
{
    public function __construct(private readonly ${cap}Repository $repository)
    {
    }

    public function execute(string $id): ${cap}Data
    {
        if (empty($id)) {
            throw new \\InvalidArgumentException('${cap}: "id" is required.');
        }

        $data = new ${cap}Data($id, now()->toIso8601String());
        $this->repository->save($data);

        return $data;
    }
}
`,
    },
    infrastructure: {
      path: `app/Repositories/${cap}Repository.php`,
      content: `<?php

namespace App\\Repositories;

use App\\DataTransferObjects\\${cap}Data;

class ${cap}Repository
{
    /** @var array<string, ${cap}Data> */
    private static array $store = [];

    public function save(${cap}Data $data): void
    {
        self::$store[$data->id] = $data;
    }

    public function findById(string $id): ?${cap}Data
    {
        return self::$store[$id] ?? null;
    }
}
`,
    },
    presentation: {
      path: `app/Http/Controllers/${cap}Controller.php`,
      content: `<?php

namespace App\\Http\\Controllers;

use App\\Actions\\${cap}\\${cap}Action;
use Illuminate\\Http\\Request;
use Illuminate\\Http\\JsonResponse;

class ${cap}Controller extends Controller
{
    public function __construct(private readonly ${cap}Action $action)
    {
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->action->execute($request->input('id'));
        return response()->json($data);
    }
}
`,
    },
  };
}

function rustLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `src/slices/${s}/domain.rs`,
      content: `#[derive(Debug, Clone)]
pub struct ${cap}Entity {
    pub id: String,
    pub created_at: String,
}
`,
    },
    infrastructure: {
      path: `src/slices/${s}/repository.rs`,
      content: `use std::collections::HashMap;

use super::domain::${cap}Entity;

#[derive(Default)]
pub struct ${cap}Repository {
    store: HashMap<String, ${cap}Entity>,
}

impl ${cap}Repository {
    pub fn save(&mut self, entity: ${cap}Entity) {
        self.store.insert(entity.id.clone(), entity);
    }

    pub fn find_by_id(&self, id: &str) -> Option<&${cap}Entity> {
        self.store.get(id)
    }
}
`,
    },
    application: {
      path: `src/slices/${s}/service.rs`,
      content: `use super::domain::${cap}Entity;
use super::repository::${cap}Repository;

pub struct ${cap}Service<'a> {
    repository: &'a mut ${cap}Repository,
}

impl<'a> ${cap}Service<'a> {
    pub fn new(repository: &'a mut ${cap}Repository) -> Self {
        Self { repository }
    }

    pub fn create(&mut self, id: String) -> Result<${cap}Entity, String> {
        if id.is_empty() {
            return Err("${cap}: \\"id\\" is required.".to_string());
        }
        let entity = ${cap}Entity { id: id.clone(), created_at: current_timestamp() };
        self.repository.save(entity.clone());
        Ok(entity)
    }
}

fn current_timestamp() -> String {
    "1970-01-01T00:00:00Z".to_string()
}
`,
    },
    presentation: {
      path: `src/slices/${s}/handler.rs`,
      content: `use std::sync::{Arc, Mutex};

use axum::{extract::State, Json};

use super::domain::${cap}Entity;
use super::repository::${cap}Repository;
use super::service::${cap}Service;

pub async fn create_${s}(
    State(repository): State<Arc<Mutex<${cap}Repository>>>,
    Json(id): Json<String>,
) -> Json<Result<${cap}Entity, String>> {
    let mut repo = repository.lock().unwrap();
    let mut service = ${cap}Service::new(&mut repo);
    Json(service.create(id))
}
`,
    },
  };
}

function pythonLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `app/slices/${s}/domain.py`,
      content: `from dataclasses import dataclass


@dataclass
class ${cap}Entity:
    id: str
    created_at: str
`,
    },
    infrastructure: {
      path: `app/slices/${s}/repository.py`,
      content: `from .domain import ${cap}Entity


class ${cap}Repository:
    def __init__(self) -> None:
        self._store: dict[str, ${cap}Entity] = {}

    def save(self, entity: ${cap}Entity) -> None:
        self._store[entity.id] = entity

    def find_by_id(self, id: str) -> ${cap}Entity | None:
        return self._store.get(id)
`,
    },
    application: {
      path: `app/slices/${s}/service.py`,
      content: `from datetime import datetime, timezone

from .domain import ${cap}Entity
from .repository import ${cap}Repository


class ${cap}Service:
    def __init__(self, repository: ${cap}Repository) -> None:
        self.repository = repository

    def create(self, id: str) -> ${cap}Entity:
        if not id:
            raise ValueError('${cap}: "id" is required.')
        entity = ${cap}Entity(id=id, created_at=datetime.now(timezone.utc).isoformat())
        self.repository.save(entity)
        return entity

    def get_by_id(self, id: str) -> ${cap}Entity | None:
        return self.repository.find_by_id(id)
`,
    },
    presentation: {
      path: `app/slices/${s}/router.py`,
      content: `from fastapi import APIRouter

from .repository import ${cap}Repository
from .service import ${cap}Service

router = APIRouter(prefix="/${s}", tags=["${s}"])
service = ${cap}Service(${cap}Repository())


@router.post("/")
def create_${s}(id: str):
    return service.create(id)
`,
    },
  };
}

function goLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `internal/slices/${s}/domain.go`,
      content: `package ${s}

type ${cap}Entity struct {
	ID        string
	CreatedAt string
}
`,
    },
    infrastructure: {
      path: `internal/slices/${s}/repository.go`,
      content: `package ${s}

type ${cap}Repository struct {
	store map[string]${cap}Entity
}

func New${cap}Repository() *${cap}Repository {
	return &${cap}Repository{store: make(map[string]${cap}Entity)}
}

func (r *${cap}Repository) Save(entity ${cap}Entity) {
	r.store[entity.ID] = entity
}

func (r *${cap}Repository) FindByID(id string) (${cap}Entity, bool) {
	entity, ok := r.store[id]
	return entity, ok
}
`,
    },
    application: {
      path: `internal/slices/${s}/service.go`,
      content: `package ${s}

import (
	"errors"
	"time"
)

type ${cap}Service struct {
	repository *${cap}Repository
}

func New${cap}Service(repository *${cap}Repository) *${cap}Service {
	return &${cap}Service{repository: repository}
}

func (s *${cap}Service) Create(id string) (${cap}Entity, error) {
	if id == "" {
		return ${cap}Entity{}, errors.New("${cap}: \\"id\\" is required")
	}
	entity := ${cap}Entity{ID: id, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	s.repository.Save(entity)
	return entity, nil
}
`,
    },
    presentation: {
      path: `internal/slices/${s}/handler.go`,
      content: `package ${s}

import (
	"encoding/json"
	"net/http"
)

func NewHandler(service *${cap}Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		entity, err := service.Create(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(entity)
	}
}
`,
    },
  };
}

function flutterLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `lib/features/${s}/domain/${s}_entity.dart`,
      content: `class ${cap}Entity {
  final String id;
  final String createdAt;

  const ${cap}Entity({required this.id, required this.createdAt});
}
`,
    },
    infrastructure: {
      path: `lib/features/${s}/infrastructure/${s}_repository.dart`,
      content: `import '../domain/${s}_entity.dart';

class ${cap}Repository {
  final Map<String, ${cap}Entity> _store = {};

  void save(${cap}Entity entity) {
    _store[entity.id] = entity;
  }

  ${cap}Entity? findById(String id) => _store[id];
}
`,
    },
    application: {
      path: `lib/features/${s}/application/${s}_service.dart`,
      content: `import 'package:flutter/foundation.dart';

import '../domain/${s}_entity.dart';
import '../infrastructure/${s}_repository.dart';

class ${cap}Service {
  final ${cap}Repository repository;

  ${cap}Service(this.repository);

  ${cap}Entity create(String id) {
    if (id.isEmpty) {
      throw ArgumentError('${cap}: "id" is required.');
    }
    final entity = ${cap}Entity(id: id, createdAt: DateTime.now().toIso8601String());
    repository.save(entity);
    return entity;
  }
}
`,
    },
    presentation: {
      path: `lib/features/${s}/presentation/${s}_widget.dart`,
      content: `import 'package:flutter/widgets.dart';

import '../application/${s}_service.dart';

class ${cap}Widget extends StatelessWidget {
  final ${cap}Service service;

  const ${cap}Widget({super.key, required this.service});

  @override
  Widget build(BuildContext context) {
    return const SizedBox.shrink();
  }
}
`,
    },
  };
}

function rubyLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `app/domain/${s}_entity.rb`,
      content: `${cap}Entity = Struct.new(:id, :created_at, keyword_init: true)
`,
    },
    infrastructure: {
      path: `app/repositories/${s}_repository.rb`,
      content: `class ${cap}Repository
  def initialize
    @store = {}
  end

  def save(entity)
    @store[entity.id] = entity
  end

  def find_by_id(id)
    @store[id]
  end
end
`,
    },
    application: {
      path: `app/services/${s}_service.rb`,
      content: `require_relative '../domain/${s}_entity'
require_relative '../repositories/${s}_repository'

class ${cap}Service
  def initialize(repository = ${cap}Repository.new)
    @repository = repository
  end

  def call(id:)
    raise ArgumentError, '${cap}: "id" is required.' if id.nil? || id.empty?

    entity = ${cap}Entity.new(id: id, created_at: Time.now.utc.iso8601)
    @repository.save(entity)
    entity
  end
end
`,
    },
    presentation: {
      path: `app/controllers/${s}_controller.rb`,
      content: `class ${cap}Controller < ApplicationController
  def create
    entity = ${cap}Service.new.call(id: params[:id])
    render json: entity.to_h
  end
end
`,
    },
  };
}

function elixirLayers(s: string, cap: string): LayerFiles {
  return {
    domain: {
      path: `lib/app/${s}/${s}.ex`,
      content: `defmodule App.${cap}.${cap} do
  defstruct [:id, :created_at]
end
`,
    },
    infrastructure: {
      path: `lib/app/${s}/${s}_repository.ex`,
      content: `defmodule App.${cap}.${cap}Repository do
  use Agent

  def start_link(_opts \\\\ []) do
    Agent.start_link(fn -> %{} end, name: __MODULE__)
  end

  def save(entity) do
    Agent.update(__MODULE__, &Map.put(&1, entity.id, entity))
  end

  def find_by_id(id) do
    Agent.get(__MODULE__, &Map.get(&1, id))
  end
end
`,
    },
    application: {
      path: `lib/app/${s}/${s}_context.ex`,
      content: `defmodule App.${cap}.${cap}Context do
  alias App.${cap}.${cap}
  alias App.${cap}.${cap}Repository

  def create_${s}(id) when is_binary(id) and id != "" do
    entity = %${cap}{id: id, created_at: DateTime.utc_now() |> DateTime.to_iso8601()}
    ${cap}Repository.save(entity)
    {:ok, entity}
  end

  def create_${s}(_id), do: {:error, "${cap}: \\"id\\" is required."}

  def get_${s}(id), do: ${cap}Repository.find_by_id(id)
end
`,
    },
    presentation: {
      path: `lib/app_web/controllers/${s}_controller.ex`,
      content: `defmodule AppWeb.${cap}Controller do
  use AppWeb, :controller

  alias App.${cap}.${cap}Context

  def create(conn, %{"id" => id}) do
    case ${cap}Context.create_${s}(id) do
      {:ok, entity} -> json(conn, entity)
      {:error, reason} -> conn |> put_status(:bad_request) |> json(%{error: reason})
    end
  end
end
`,
    },
  };
}

function layersForStack(stack: ScaffoldOptions['stack'], sliceName: string, cap: string): LayerFiles {
  switch (stack) {
    case 'rust':
      return rustLayers(sliceName, cap);
    case 'python':
      return pythonLayers(sliceName, cap);
    case 'go':
      return goLayers(sliceName, cap);
    case 'flutter':
      return flutterLayers(sliceName, cap);
    case 'ruby':
      return rubyLayers(sliceName, cap);
    case 'dotnet':
      return dotnetLayers(cap);
    case 'elixir':
      return elixirLayers(sliceName, cap);
    case 'laravel':
      return laravelLayers(cap);
    case 'react':
      return reactLikeLayers(sliceName, cap, false);
    case 'reactnative':
      return reactLikeLayers(sliceName, cap, true);
    case 'node':
    default:
      return nodeLayers(sliceName, cap);
  }
}

export function generateSliceFiles(options: ScaffoldOptions): GeneratedFile[] {
  const { sliceName, stack, layer = 'full' } = options;
  const cap = sliceName.charAt(0).toUpperCase() + sliceName.slice(1);
  const layers = layersForStack(stack, sliceName, cap);

  if (layer !== 'full') {
    return [layers[layer]];
  }

  const files = [layers.domain, layers.application, layers.infrastructure, layers.presentation];

  if (stack === 'rust') {
    files.push({
      path: `src/slices/${sliceName}/mod.rs`,
      content: `pub mod domain;
pub mod repository;
pub mod service;
pub mod handler;
`,
    });
  }

  return files;
}
