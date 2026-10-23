import { describe, it, expect } from 'vitest';
import { parseGoTestJson, parseFlutterJson, parseRspecJson, parseJestLikeJson } from '../../src/features/quality_assurance/services/parsers/json_reporters.js';
import { parseJUnitXml, parseTrx } from '../../src/features/quality_assurance/services/parsers/xml_reporters.js';
import { parseCargoTest, parseMixTest, parseDiagnostics } from '../../src/features/quality_assurance/services/parsers/text_reporters.js';
import { parseEslintJson } from '../../src/features/quality_assurance/services/parsers/lint_reporters.js';

describe('structured report parsers', () => {
  it('go test -json: counts tests and extracts the failing assertion location', () => {
    const out = [
      '{"Action":"run","Package":"app/internal/slices/orders","Test":"TestCreate"}',
      '{"Action":"output","Package":"app/internal/slices/orders","Test":"TestCreate","Output":"    service_test.go:14: expected 2, got 1\\n"}',
      '{"Action":"fail","Package":"app/internal/slices/orders","Test":"TestCreate","Elapsed":0}',
      '{"Action":"pass","Package":"app/internal/slices/orders","Test":"TestRejects","Elapsed":0}',
      '{"Action":"fail","Package":"app/internal/slices/orders","Elapsed":0.1}',
    ].join('\n');
    const r = parseGoTestJson(out)!;
    expect(r).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(r.failures[0]).toMatchObject({ file: 'service_test.go', line: 14, testName: 'TestCreate', errorMessage: 'expected 2, got 1' });
  });

  it('go test -json: reports build errors (Go >= 1.24 build-output events)', () => {
    const out = '{"ImportPath":"app/x","Action":"build-output","Output":"internal/x/a.go:3:2: undefined: foo\\n"}\n{"ImportPath":"app/x","Action":"build-fail"}';
    const r = parseGoTestJson(out)!;
    expect(r.failed).toBe(1);
    expect(r.failures[0]).toMatchObject({ file: 'internal/x/a.go', line: 3, errorMessage: 'undefined: foo' });
  });

  it('cargo test: sums every test binary and reads panic locations', () => {
    const out = `running 2 tests
test slices::orders::service::tests::creates ... ok
test slices::orders::service::tests::rejects ... FAILED

failures:

---- slices::orders::service::tests::rejects stdout ----

thread 'slices::orders::service::tests::rejects' panicked at src/slices/orders/service.rs:41:9:
assertion failed: service.create("").is_err()

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`;
    const r = parseCargoTest(out)!;
    expect(r).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(r.failures[0]).toMatchObject({ file: 'src/slices/orders/service.rs', line: 41, errorMessage: 'assertion failed: service.create("").is_err()' });
  });

  it('cargo test: compile errors become failures when no test ran', () => {
    const out = `error[E0425]: cannot find value \`x\` in this scope\n --> src/main.rs:2:13\n  |`;
    const r = parseCargoTest(out)!;
    expect(r.failures[0]).toMatchObject({ file: 'src/main.rs', line: 2 });
  });

  it('mix test: summary with doctests and failure blocks', () => {
    const out = `  1) test creates and retrieves (App.Orders.OrdersContextTest)
     test/app/orders/orders_context_test.exs:14
     Assertion with == failed
     code:  assert 1 == 2

Finished in 0.05 seconds (0.00s async, 0.05s sync)
1 doctest, 3 tests, 1 failure`;
    const r = parseMixTest(out)!;
    expect(r).toMatchObject({ total: 4, failed: 1, passed: 3 });
    expect(r.failures[0]).toMatchObject({ file: 'test/app/orders/orders_context_test.exs', line: 14, errorMessage: 'Assertion with == failed' });
  });

  it('mix test: Elixir 1.20 "Result:" summary', () => {
    const out = `  1) test rejects a missing id (Shop.Orders.OrdersContextTest)
     test/shop/orders/orders_context_test.exs:16
     Assertion with == failed
     code:  assert 1 == 2

*
Finished in 0.05 seconds (0.00s async, 0.05s sync)

Result: 3/4 passed, 1 skipped
Failed: 1 test`;
    const r = parseMixTest(out)!;
    expect(r).toMatchObject({ total: 5, passed: 3, failed: 1, skipped: 1 });
    expect(r.failures[0]).toMatchObject({ line: 16, testName: 'Shop.Orders.OrdersContextTest: rejects a missing id' });
    expect(parseMixTest('Result: 4 passed')).toMatchObject({ total: 4, passed: 4, failed: 0 });
  });

  it('pytest JUnit XML: failures, skips and collection errors', () => {
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3">
<testcase classname="tests.test_orders" name="test_ok" file="tests/test_orders.py" line="4"/>
<testcase classname="tests.test_orders" name="test_bad" file="tests/test_orders.py" line="9"><failure message="AssertionError: assert 1 == 2">trace</failure></testcase>
<testcase classname="tests.test_orders" name="test_skip"><skipped message="later"/></testcase>
</testsuite></testsuites>`;
    const r = parseJUnitXml(xml)!;
    expect(r).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
    expect(r.failures[0]).toMatchObject({ testName: 'tests.test_orders::test_bad', errorMessage: 'AssertionError: assert 1 == 2', line: 10 });

    const collection = parseJUnitXml('<testsuites><testsuite name="pytest" errors="1" tests="0"></testsuite></testsuites>')!;
    expect(collection.failed).toBe(1);
  });

  it('dotnet TRX: outcomes and stack-trace locations', () => {
    const trx = `<TestRun><Results>
<UnitTestResult testName="Create" outcome="Passed" />
<UnitTestResult testName="Rejects" outcome="Failed"><Output><ErrorInfo><Message>Assert.Equal() Failure</Message><StackTrace>   at Tests.X() in C:\\src\\Tests\\XTests.cs:line 22</StackTrace></ErrorInfo></Output></UnitTestResult>
</Results></TestRun>`;
    const r = parseTrx(trx)!;
    expect(r).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(r.failures[0]).toMatchObject({ testName: 'Rejects', line: 22, errorMessage: 'Assert.Equal() Failure' });
  });

  it('flutter --reporter json: ignores hidden loading tests', () => {
    const out = [
      '{"type":"testStart","test":{"id":1,"name":"loading /p/test/a_test.dart","url":null}}',
      '{"type":"testDone","testID":1,"result":"success","hidden":true,"skipped":false}',
      '{"type":"testStart","test":{"id":2,"name":"creates","line":5,"url":"file:///p/test/a_test.dart"}}',
      '{"type":"error","testID":2,"error":"Expected: <1>\\n  Actual: <2>"}',
      '{"type":"testDone","testID":2,"result":"failure","hidden":false,"skipped":false}',
    ].join('\n');
    const r = parseFlutterJson(out)!;
    expect(r).toMatchObject({ total: 1, failed: 1 });
    expect(r.failures[0]).toMatchObject({ testName: 'creates', line: 5, errorMessage: 'Expected: <1>' });
  });

  it('rspec json and jest json', () => {
    const rspec = parseRspecJson(JSON.stringify({
      examples: [
        { full_description: 'A works', status: 'passed' },
        { full_description: 'A fails', status: 'failed', file_path: './spec/a_spec.rb', line_number: 7, exception: { message: 'expected 1 got 2' } },
      ],
      summary: { example_count: 2, failure_count: 1, pending_count: 0, errors_outside_of_examples_count: 0 },
    }))!;
    expect(rspec.failures[0]).toMatchObject({ file: 'spec/a_spec.rb', line: 7 });

    const loadError = parseJestLikeJson(JSON.stringify({ numTotalTests: 0, testResults: [{ name: 'x.test.ts', status: 'failed', message: 'Cannot find module', assertionResults: [] }] }))!;
    expect(loadError.failed).toBe(1);
    expect(loadError.failures[0].errorMessage).toContain('Cannot find module');
  });

  it('diagnostics: tsc, C#, go vet, ruff, flutter analyze, Windows paths', () => {
    const out = [
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      'C:\\proj\\Features\\X.cs(10,5): error CS0103: The name \'y\' does not exist [C:\\proj\\App.csproj]',
      'C:\\proj\\Features\\W.cs(1,1): warning CS8618: nullable [C:\\proj\\App.csproj]',
      './internal/x/a.go:4:2: fmt.Printf format %d has arg of wrong type',
      'app/x.py:1:8: F401 [*] `os` imported but unused',
      '  error • Undefined name \'foo\' • lib/main.dart:3:5 • undefined_identifier',
      "  error - A value of type 'String' can't be returned - lib\\features\\x.dart:19:17 - return_of_invalid_type",
      'src/main.rs:2:13: error[E0425]: cannot find value `x` in this scope',
    ].join('\n');
    const d = parseDiagnostics(out);
    expect(d.map((x) => x.file)).toEqual(['src/a.ts', 'C:\\proj\\Features\\X.cs', './internal/x/a.go', 'app/x.py', 'lib/main.dart', 'lib\\features\\x.dart', 'src/main.rs']);
    expect(d[5]).toMatchObject({ line: 19, errorMessage: "return_of_invalid_type: A value of type 'String' can't be returned" });
  });

  it('eslint json: only errors fail the check', () => {
    const r = parseEslintJson(JSON.stringify([
      { filePath: '/p/a.ts', messages: [{ severity: 1, line: 1, message: 'warn', ruleId: 'no-console' }] },
      { filePath: '/p/b.ts', messages: [{ severity: 2, line: 4, message: 'bad', ruleId: 'no-undef' }] },
    ]))!;
    expect(r).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(r.failures[0]).toMatchObject({ file: '/p/b.ts', line: 4, errorMessage: 'no-undef: bad' });
  });
});
