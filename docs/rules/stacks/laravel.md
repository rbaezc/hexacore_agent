# Laravel / PHP (laravelhexagen)

## Slice Layout
```
app/Features/<Slice>/
  Domain/<Slice>Data.php                        readonly value object
  Domain/<Slice>Repository.php                  interface (port)
  Application/Create<Slice>Action.php           single-responsibility action
  Infrastructure/InMemory<Slice>Repository.php  (Eloquent adapters live here too)
  Presentation/<Slice>Controller.php
  <Slice>ServiceProvider.php                    binds port → adapter (register in bootstrap/providers.php)
tests/Unit/Features/<Slice>/Create<Slice>ActionTest.php
```

## Conventions
- `declare(strict_types=1);`, typed properties, return type hints everywhere; `final` by default.
- Single-responsibility Action classes; controllers only translate HTTP to action calls.
- Eloquent models are infrastructure: actions receive and return domain data objects, not models.
- Schemas follow the database conventions (FK constraints, indexes, audit columns).

## Example
### Good
```php
public function __construct(private readonly OrdersRepository $repository) {}
```
### Bad
```php
Order::create($request->all()); // Eloquent + raw request inside an action
```

## Quality Commands
- test: `php artisan test --log-junit` (or `vendor/bin/phpunit`)
- typecheck: `vendor/bin/phpstan analyse`
- lint: `vendor/bin/pint --test`
