# HexaCore Database Conventions

## Mandatory Rules
1. **Foreign Key Constraints (FK Constraints)**: Strict and mandatory usage of foreign key constraints across all relational entities.
2. **Search Key Indexes**: Every frequently queried field must possess an explicit index.
3. **Snake Case Naming**: Table names in plural, column names in `snake_case`.
4. **Auditable Fields**: Every relational table must include `created_at`, `updated_at`, and `deleted_at` (when soft deletion is supported).
5. **ACID Transactionality**: Multi-table operations must be wrapped within explicit database transactions.

## Ownership
- Each slice owns its tables. Another slice never queries them directly; it consumes events or calls a published port.
- Migrations live with the stack's migration tool (Ecto, EF Core, Laravel, Alembic, sqlx, golang-migrate, Active Record) and are named after the slice: `create_orders_tables`.

## Examples
### Good
```sql
CREATE TABLE order_lines (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_lines_order_id ON order_lines(order_id);
```

### Bad
```sql
CREATE TABLE OrderLine (OrderId INT, Sku TEXT); -- no PK, no FK, no index, PascalCase, no audit columns
```

## Repository Adapters
- Repository ports are declared in the slice's domain layer; database adapters implement them in infrastructure.
- Adapters map rows to domain entities; entities never carry ORM annotations when the stack allows separating them.
