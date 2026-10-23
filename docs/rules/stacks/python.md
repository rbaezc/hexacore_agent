# Python / FastAPI (pyhexagen)

## Slice Layout
```
app/slices/<slice>/
  __init__.py
  domain.py       frozen dataclasses + repository Protocol (port)
  service.py      use cases; depends on the Protocol
  repository.py   adapters (InMemory<Slice>Repository, SQL adapters)
  router.py       build_router(service) -> APIRouter (Pydantic request models)
  module.py       composition root: service + router
tests/test_<slice>_service.py
```

## Conventions
- Type hints on every function; `mypy` clean. Domain entities are `@dataclass(frozen=True)`.
- Ports are `typing.Protocol`; adapters don't inherit, they conform.
- Pydantic models only at the presentation boundary; the domain stays framework-free.
- Raise `ValueError` or domain exceptions in services; map them to `HTTPException` in routers.

## Example
### Good
```python
class OrdersService:
    def __init__(self, repository: OrdersRepository) -> None: ...
```
### Bad
```python
from sqlalchemy.orm import Session  # imported inside domain.py
```

## Quality Commands
- test: `pytest --junitxml`
- typecheck: `python -m mypy .`
- lint: `python -m ruff check .`
- build: `python -m compileall`
