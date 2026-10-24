# Ruby / Rails (rubyhexagen)

## Slice Layout
```
app/features/<slice>/                         (Zeitwerk: <Slice>::Domain::…, <Slice>::Application::…)
  domain/<slice>_entity.rb                     Struct / value objects
  application/create_<slice>.rb                service object with #call(**)
  infrastructure/in_memory_<slice>_repository.rb   (ActiveRecord adapters live here)
  presentation/<slice>_controller.rb
  composition.rb                               wires repository → use cases
spec/features/<slice>/create_<slice>_spec.rb
```

## Conventions
- Service objects expose a single `#call` with keyword arguments; dependencies injected via `initialize`.
- Repositories are duck-typed ports (`#save`, `#find_by_id`); ActiveRecord stays in infrastructure.
- `# frozen_string_literal: true` in every file; RuboCop clean.

## Example
### Good
```ruby
Orders::Application::CreateOrders.new(repository).call(id: params[:id])
```
### Bad
```ruby
def create = Order.create!(params.permit!) # persistence + mass assignment in a controller
```

## Quality Commands
- test: `bundle exec rspec --format json`
- lint: `bundle exec rubocop`
