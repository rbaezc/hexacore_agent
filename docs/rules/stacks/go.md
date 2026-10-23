# Go / Golang (gohexagen)

## Slice Layout
```
internal/slices/<slice>/      (package name = slice name without separators)
  domain.go       entity + Repository interface (port)
  service.go      use cases; exported sentinel errors (ErrMissingID)
  repository.go   InMemoryRepository (sync.RWMutex), DB adapters
  handler.go      net/http handlers
  module.go       Register(mux): composition root
  service_test.go
```

## Conventions
- Explicit error checking `if err != nil`; wrap with `fmt.Errorf("...: %w", err)`; compare with `errors.Is`.
- Accept interfaces, return structs. Ports are small interfaces declared where they are consumed (domain.go).
- No package-level mutable state; dependencies flow through constructors (`NewService(repo)`).
- `internal/` keeps slices private to the module.

## Example
### Good
```go
func NewService(repository Repository) *Service { return &Service{repository: repository} }
```
### Bad
```go
var db *sql.DB // global used directly from service.go
```

## Quality Commands
- test: `go test -json ./...`
- build/typecheck: `go build ./...`
- lint: `go vet ./...`
