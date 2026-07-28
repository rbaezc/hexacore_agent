# Vertical Slice Architecture (VSA) Rules

## Core Principles
1. **Feature Isolation**: Each feature (Slice) resides in its own self-contained directory containing its domain models, handlers, DTOs, and validations.
2. **Zero Horizontal Coupling**: A slice must never directly import internal presentation or persistence logic from another slice.
3. **Explicit Contracts**: Cross-slice communication must be performed exclusively via Domain Events or interfaces exposed in `shared/domain`.
4. **File Line Limit**: No source file shall exceed **250 lines of code** (SRP and High Cohesion).
5. **SOLID Principles**:
   - **Single Responsibility Principle (SRP)**
   - **Open/Closed Principle (OCP)**
   - **Liskov Substitution Principle (LSP)**
   - **Interface Segregation Principle (ISP)**
   - **Dependency Inversion Principle (DIP)**
