import { SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

export function goBlueprint(n: SliceNames): SliceBlueprint {
  const pkg = n.flat;
  const base = `internal/slices/${pkg}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/domain.go`,
          role: 'domain',
          content: `package ${pkg}

// ${n.pascal}Entity is the aggregate root of the ${n.snake} slice.
type ${n.pascal}Entity struct {
	ID        string \`json:"id"\`
	CreatedAt string \`json:"createdAt"\`
}

// Repository is the port the service depends on; infrastructure implements it.
type Repository interface {
	Save(entity ${n.pascal}Entity) error
	FindByID(id string) (${n.pascal}Entity, bool)
}
`,
        },
      ],
      application: [
        {
          path: `${base}/service.go`,
          role: 'application',
          content: `package ${pkg}

import (
	"errors"
	"time"
)

// ErrMissingID is returned when a ${n.snake} is created without an id.
var ErrMissingID = errors.New("${n.snake}: id is required")

type Service struct {
	repository Repository
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) Create(id string) (${n.pascal}Entity, error) {
	if id == "" {
		return ${n.pascal}Entity{}, ErrMissingID
	}
	entity := ${n.pascal}Entity{ID: id, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	if err := s.repository.Save(entity); err != nil {
		return ${n.pascal}Entity{}, err
	}
	return entity, nil
}

func (s *Service) GetByID(id string) (${n.pascal}Entity, bool) {
	return s.repository.FindByID(id)
}
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/repository.go`,
          role: 'infrastructure',
          content: `package ${pkg}

import "sync"

type InMemoryRepository struct {
	mu    sync.RWMutex
	store map[string]${n.pascal}Entity
}

func NewInMemoryRepository() *InMemoryRepository {
	return &InMemoryRepository{store: make(map[string]${n.pascal}Entity)}
}

func (r *InMemoryRepository) Save(entity ${n.pascal}Entity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.store[entity.ID] = entity
	return nil
}

func (r *InMemoryRepository) FindByID(id string) (${n.pascal}Entity, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entity, ok := r.store[id]
	return entity, ok
}
`,
        },
      ],
      presentation: [
        {
          path: `${base}/handler.go`,
          role: 'presentation',
          content: `package ${pkg}

import (
	"encoding/json"
	"errors"
	"net/http"
)

func NewCreateHandler(service *Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string \`json:"id"\`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		entity, err := service.Create(body.ID)
		if errors.Is(err, ErrMissingID) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(entity)
	}
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/module.go`,
        role: 'module',
        content: `package ${pkg}

import "net/http"

// Register is the composition root of the ${n.snake} slice.
func Register(mux *http.ServeMux) {
	service := NewService(NewInMemoryRepository())
	mux.HandleFunc("POST /${n.kebab}", NewCreateHandler(service))
}
`,
      },
    ],
    tests: [
      {
        path: `${base}/service_test.go`,
        role: 'test',
        content: `package ${pkg}

import (
	"errors"
	"testing"
)

func TestCreateAndRetrieve${n.pascal}(t *testing.T) {
	service := NewService(NewInMemoryRepository())
	created, err := service.Create("${n.kebab}-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found, ok := service.GetByID("${n.kebab}-1")
	if !ok || found != created {
		t.Fatalf("expected %+v, got %+v (found=%v)", created, found, ok)
	}
}

func TestRejectsMissingID(t *testing.T) {
	service := NewService(NewInMemoryRepository())
	if _, err := service.Create(""); !errors.Is(err, ErrMissingID) {
		t.Fatalf("expected ErrMissingID, got %v", err)
	}
}
`,
      },
    ],
    notes: [],
  };
}
