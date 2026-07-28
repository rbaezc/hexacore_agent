# HexaCore Database Conventions

## Mandatory Rules
1. **Foreign Key Constraints (FK Constraints)**: Strict and mandatory usage of foreign key constraints across all relational entities.
2. **Search Key Indexes**: Every frequently queried field must possess an explicit index.
3. **Snake Case Naming**: Table names in plural, column names in `snake_case`.
4. **Auditable Fields**: Every relational table must include `created_at`, `updated_at`, and `deleted_at` (when soft deletion is supported).
5. **ACID Transactionality**: Multi-table operations must be wrapped within explicit database transactions.
