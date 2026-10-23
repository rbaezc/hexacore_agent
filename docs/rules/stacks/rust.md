# Rust (rusthexagen)

## Slice Layout
```
src/slices/<slice>/
  domain.rs       entity + <Slice>Repository trait (port, Send + Sync)
  service.rs      <Slice>Service<R: Repository> + #[cfg(test)] unit tests
  repository.rs   InMemory<Slice>Repository (RwLock<HashMap>) and DB adapters
  handler.rs      axum handlers, generic over the repository
  mod.rs          module declarations + router(): composition root
src/slices/mod.rs   `pub mod <slice>;` (HexaCore registers new slices here)
```

## Conventions
- Idiomatic error handling with `Result<T, E>`; no `unwrap()` outside tests.
- Zero-cost abstractions: generics over trait objects in hot paths; no raw pointers or `unsafe`.
- Interior mutability (`RwLock`) inside adapters so services take `&self`.
- serde derives only on types that cross the HTTP boundary.

## Example
### Good
```rust
pub struct OrdersService<R: OrdersRepository> { repository: R }
```
### Bad
```rust
static mut ORDERS: Vec<Order> = Vec::new(); // global mutable state
```

## Quality Commands
- test: `cargo test --no-fail-fast`
- typecheck: `cargo check`
- lint: `cargo clippy -- -D warnings`
