import { SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

export function rustBlueprint(n: SliceNames): SliceBlueprint {
  const base = `src/slices/${n.snake}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/domain.rs`,
          role: 'domain',
          content: `#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ${n.pascal}Entity {
    pub id: String,
    pub created_at: u64,
}

/// Port implemented by the infrastructure layer.
pub trait ${n.pascal}Repository: Send + Sync {
    fn save(&self, entity: ${n.pascal}Entity);
    fn find_by_id(&self, id: &str) -> Option<${n.pascal}Entity>;
}
`,
        },
      ],
      application: [
        {
          path: `${base}/service.rs`,
          role: 'application',
          content: `use std::time::{SystemTime, UNIX_EPOCH};

use super::domain::{${n.pascal}Entity, ${n.pascal}Repository};

pub struct ${n.pascal}Service<R: ${n.pascal}Repository> {
    repository: R,
}

impl<R: ${n.pascal}Repository> ${n.pascal}Service<R> {
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    pub fn create(&self, id: &str) -> Result<${n.pascal}Entity, String> {
        if id.is_empty() {
            return Err("${n.pascal}: \\"id\\" is required.".to_string());
        }
        let created_at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default();
        let entity = ${n.pascal}Entity { id: id.to_string(), created_at };
        self.repository.save(entity.clone());
        Ok(entity)
    }

    pub fn get_by_id(&self, id: &str) -> Option<${n.pascal}Entity> {
        self.repository.find_by_id(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::repository::InMemory${n.pascal}Repository;

    #[test]
    fn creates_and_retrieves_${n.snake}() {
        let service = ${n.pascal}Service::new(InMemory${n.pascal}Repository::default());
        let created = service.create("${n.kebab}-1").unwrap();
        assert_eq!(service.get_by_id("${n.kebab}-1"), Some(created));
    }

    #[test]
    fn rejects_missing_id() {
        let service = ${n.pascal}Service::new(InMemory${n.pascal}Repository::default());
        assert!(service.create("").is_err());
    }
}
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/repository.rs`,
          role: 'infrastructure',
          content: `use std::collections::HashMap;
use std::sync::RwLock;

use super::domain::{${n.pascal}Entity, ${n.pascal}Repository};

#[derive(Default)]
pub struct InMemory${n.pascal}Repository {
    store: RwLock<HashMap<String, ${n.pascal}Entity>>,
}

impl ${n.pascal}Repository for InMemory${n.pascal}Repository {
    fn save(&self, entity: ${n.pascal}Entity) {
        self.store.write().expect("${n.snake} store poisoned").insert(entity.id.clone(), entity);
    }

    fn find_by_id(&self, id: &str) -> Option<${n.pascal}Entity> {
        self.store.read().expect("${n.snake} store poisoned").get(id).cloned()
    }
}
`,
        },
      ],
      presentation: [
        {
          path: `${base}/handler.rs`,
          role: 'presentation',
          content: `use std::sync::Arc;

use axum::{extract::State, http::StatusCode, Json};

use super::domain::{${n.pascal}Entity, ${n.pascal}Repository};
use super::service::${n.pascal}Service;

#[derive(serde::Deserialize)]
pub struct Create${n.pascal}Request {
    pub id: String,
}

pub async fn create_${n.snake}<R: ${n.pascal}Repository + 'static>(
    State(service): State<Arc<${n.pascal}Service<R>>>,
    Json(body): Json<Create${n.pascal}Request>,
) -> Result<(StatusCode, Json<${n.pascal}Entity>), (StatusCode, String)> {
    service
        .create(&body.id)
        .map(|entity| (StatusCode::CREATED, Json(entity)))
        .map_err(|error| (StatusCode::BAD_REQUEST, error))
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/mod.rs`,
        role: 'module',
        content: `//! ${n.pascal} slice. Composition root: \`router()\` wires the in-memory repository.
pub mod domain;
pub mod handler;
pub mod repository;
pub mod service;

use std::sync::Arc;

use axum::{routing::post, Router};

pub fn router() -> Router {
    let service = Arc::new(service::${n.pascal}Service::new(repository::InMemory${n.pascal}Repository::default()));
    Router::new()
        .route("/${n.kebab}", post(handler::create_${n.snake}::<repository::InMemory${n.pascal}Repository>))
        .with_state(service)
}
`,
      },
    ],
    registrations: [{ path: 'src/slices/mod.rs', line: `pub mod ${n.snake};` }],
    tests: [],
    notes: [
      `Merge \`slices::${n.snake}::router()\` into your app (src/slices/mod.rs was updated; main.rs/lib.rs must declare \`mod slices;\`). Requires the axum and serde (derive) crates.`,
    ],
  };
}
