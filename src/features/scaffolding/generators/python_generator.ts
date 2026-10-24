import { SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

export function pythonBlueprint(n: SliceNames): SliceBlueprint {
  const base = `app/slices/${n.snake}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/domain.py`,
          role: 'domain',
          content: `from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ${n.pascal}Entity:
    id: str
    created_at: str


class ${n.pascal}Repository(Protocol):
    """Port implemented by the infrastructure layer."""

    def save(self, entity: ${n.pascal}Entity) -> None: ...

    def find_by_id(self, entity_id: str) -> ${n.pascal}Entity | None: ...
`,
        },
      ],
      application: [
        {
          path: `${base}/service.py`,
          role: 'application',
          content: `from datetime import datetime, timezone

from .domain import ${n.pascal}Entity, ${n.pascal}Repository


class ${n.pascal}Service:
    def __init__(self, repository: ${n.pascal}Repository) -> None:
        self._repository = repository

    def create(self, entity_id: str) -> ${n.pascal}Entity:
        if not entity_id:
            raise ValueError('${n.pascal}: "id" is required.')
        entity = ${n.pascal}Entity(id=entity_id, created_at=datetime.now(timezone.utc).isoformat())
        self._repository.save(entity)
        return entity

    def get_by_id(self, entity_id: str) -> ${n.pascal}Entity | None:
        return self._repository.find_by_id(entity_id)
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/repository.py`,
          role: 'infrastructure',
          content: `from .domain import ${n.pascal}Entity


class InMemory${n.pascal}Repository:
    def __init__(self) -> None:
        self._store: dict[str, ${n.pascal}Entity] = {}

    def save(self, entity: ${n.pascal}Entity) -> None:
        self._store[entity.id] = entity

    def find_by_id(self, entity_id: str) -> ${n.pascal}Entity | None:
        return self._store.get(entity_id)
`,
        },
      ],
      presentation: [
        {
          path: `${base}/router.py`,
          role: 'presentation',
          content: `from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .service import ${n.pascal}Service


class Create${n.pascal}Request(BaseModel):
    id: str


def build_router(service: ${n.pascal}Service) -> APIRouter:
    router = APIRouter(prefix="/${n.kebab}", tags=["${n.snake}"])

    @router.post("/", status_code=201)
    async def create_${n.snake}(body: Create${n.pascal}Request) -> dict[str, str]:
        try:
            entity = service.create(body.id)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return {"id": entity.id, "created_at": entity.created_at}

    return router
`,
        },
      ],
    },
    module: [
      { path: `${base}/__init__.py`, role: 'module', content: `"""${n.pascal} vertical slice."""\n` },
      {
        path: `${base}/module.py`,
        role: 'module',
        content: `"""Composition root of the ${n.snake} slice: include \`router\` in your FastAPI app."""
from .repository import InMemory${n.pascal}Repository
from .router import build_router
from .service import ${n.pascal}Service

service = ${n.pascal}Service(InMemory${n.pascal}Repository())
router = build_router(service)
`,
      },
    ],
    tests: [
      {
        path: `tests/test_${n.snake}_service.py`,
        role: 'test',
        content: `import pytest

from app.slices.${n.snake}.repository import InMemory${n.pascal}Repository
from app.slices.${n.snake}.service import ${n.pascal}Service


def test_creates_and_retrieves_${n.snake}() -> None:
    service = ${n.pascal}Service(InMemory${n.pascal}Repository())
    created = service.create("${n.kebab}-1")
    assert service.get_by_id("${n.kebab}-1") == created


def test_rejects_missing_id() -> None:
    service = ${n.pascal}Service(InMemory${n.pascal}Repository())
    with pytest.raises(ValueError, match='"id" is required'):
        service.create("")
`,
      },
    ],
    registrations: [{ path: 'app/__init__.py' }, { path: 'app/slices/__init__.py' }],
    notes: ['The presentation layer requires fastapi and pydantic. Include `module.router` in your FastAPI app.'],
  };
}
