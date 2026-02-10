# Validation Architecture: Two-Tier System

## Overview

Tabular Review implements a sophisticated **two-tier validation system** that ensures both logical consistency and mathematical correctness of LLM-extracted data.

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM EXTRACTION                            │
│  (Claude, Gemini, or Multi-Agent Consensus)                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              TIER 1: FORMAL LOGIC                            │
│  • Boolean implications (A → B)                              │
│  • Conjunctions, disjunctions                                │
│  • Mutual exclusions                                         │
│  • Dependency checking                                       │
│  • Pattern matching (regex)                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              TIER 2: SMT (Z3 SOLVER)                         │
│  • Arithmetic constraints                                    │
│  • Real number validation                                    │
│  • Multi-column equations                                    │
│  • Date/time ordering                                        │
│  • Optimization problems                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              VALIDATION RESULTS                              │
│  • Cells marked with violations                             │
│  • Detailed error messages                                   │
│  • Visual indicators in UI                                   │
│  • Counterexamples from Z3                                   │
└─────────────────────────────────────────────────────────────┘
```

## When to Use Each Tier

### Tier 1: Formal Logic (`formalLogic.ts`)

**Use for:**
- ✅ Boolean dependencies ("If X, then Y")
- ✅ Required field validation
- ✅ Mutual exclusions ("X and Y can't both be true")
- ✅ Pattern matching (regex, string checks)
- ✅ Fast, simple constraints
- ✅ Column existence checks

**Examples:**
```typescript
// If auto-renewal, then term length must exist
implies(isYes('col_auto_renewal'), exists('col_term_length'))

// Unlimited liability excludes liability cap
implies(isYes('col_unlimited'), isNo('col_liability_cap'))

// Email format validation
matches('col_email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
```

### Tier 2: SMT (`smtValidation.ts`)

**Use for:**
- ✅ Arithmetic constraints ("A + B = C")
- ✅ Numeric ranges with math ("X > Y * 2")
- ✅ Date ordering and duration calculations
- ✅ Percentage and ratio validation
- ✅ Complex multi-column equations
- ✅ Optimization and bounds checking

**Examples:**
```typescript
// Total = upfront + (recurring * months)
total.eq(upfront.add(recurring.mul(months)))

// Insurance >= 2x liability cap
insurance.ge(liabilityCap.mul(2))

// Start date < end date
startDate.lt(endDate)
```

## Decision Matrix

| Validation Need | Formal Logic | SMT (Z3) |
|-----------------|--------------|----------|
| Field exists | ✅ Best | ❌ No |
| Boolean logic | ✅ Best | ⚠️ Possible |
| String patterns | ✅ Best | ❌ No |
| Integer arithmetic | ⚠️ Limited | ✅ Best |
| Real numbers | ❌ No | ✅ Best |
| Date/time | ⚠️ Basic | ✅ Best |
| Multi-column math | ❌ No | ✅ Best |
| Percentages/ratios | ❌ No | ✅ Best |
| Performance | ✅ Fast (~1ms) | ⚠️ Slower (~20ms) |

## Example: Complete Validation Pipeline

### Document Extractions
```typescript
{
  'doc1': {
    'col_proc_auto_renewal': { value: 'Yes', confidence: 'High' },
    'col_term_length': { value: '24', confidence: 'High' },
    'col_notice_period': { value: '90', confidence: 'Medium' },
    'col_upfront_payment': { value: '$10,000', confidence: 'High' },
    'col_recurring_payment': { value: '$500', confidence: 'High' },
    'col_total_payment': { value: '$22,000', confidence: 'Low' }
  }
}
```

### Tier 1: Formal Logic Validation

```typescript
// Rule 1: Auto-renewal requires term length (PASS)
implies(
  isYes('col_proc_auto_renewal'),  // TRUE
  exists('col_term_length')         // TRUE
) → ✓ PASS

// Rule 2: Notice period should exist if termination allowed (PASS)
implies(
  isYes('col_termination_convenience'),  // FALSE (not extracted)
  exists('col_notice_period')            // TRUE
) → ✓ PASS (premise false, so implication holds)
```

### Tier 2: SMT Validation

```typescript
// Constraint 1: Term length bounds (PASS)
24 >= 1 && 24 <= 60 → ✓ PASS

// Constraint 2: Notice period bounds (PASS)
90 >= 30 && 90 <= 180 → ✓ PASS

// Constraint 3: Payment arithmetic (FAIL!)
total = upfront + (recurring * termLength)
$22,000 = $10,000 + ($500 * 24)
$22,000 = $10,000 + $12,000
$22,000 = $22,000 → ✓ PASS

// Actually let's say extracted value was wrong:
// Extracted: $20,000 (incorrect)
// Expected: $22,000
// Result: ✗ FAIL with counterexample
```

### Result Display

Cell for `col_total_payment` would show:
```
Value: $20,000
Status: validation_failed 🛡️
Errors:
  [SMT] ✗ Total payment equals upfront + recurring * term length
        (Given values total=20000, upfront=10000, recurring=500,
         term=24 violate constraint)
```

## Combining Both Tiers

### Example: Contract Payment Validation

```typescript
// TIER 1: Logical dependencies
const logicRules = [
  {
    formula: implies(
      exists('col_payment_required'),
      and(
        exists('col_payment_amount'),
        exists('col_payment_date')
      )
    )
  }
];

// TIER 2: Arithmetic validation
const smtConstraints = [
  createSMTConstraint()
    .withVariables({
      'col_payment_amount': 'real',
      'col_minimum_payment': 'real'
    })
    .withConstraint((ctx, vars) => [
      vars['col_payment_amount'].ge(vars['col_minimum_payment'])
    ])
];
```

### Example: Date and Duration Validation

```typescript
// TIER 1: Existence checks
const logicRules = [
  {
    formula: implies(
      exists('col_start_date'),
      exists('col_end_date')
    )
  }
];

// TIER 2: Mathematical constraints
const smtConstraints = [
  createSMTConstraint()
    .withVariables({
      'col_start_date': 'int',
      'col_end_date': 'int',
      'col_duration_months': 'int'
    })
    .withConstraint((ctx, vars) => {
      const start = vars['col_start_date'];
      const end = vars['col_end_date'];
      const duration = vars['col_duration_months'];

      const actualDays = end.sub(start);
      const expectedDays = duration.mul(30);

      return [
        start.lt(end),  // Date ordering
        actualDays.ge(expectedDays.sub(5)),  // Duration match
        actualDays.le(expectedDays.add(5))
      ];
    })
];
```

## Performance Comparison

### Formal Logic Engine
```
Documents: 100
Rules per doc: 10
Time per rule: ~0.1ms
Total time: ~100ms (0.1 seconds)
```

### SMT Solver (Z3)
```
Documents: 100
Constraints per doc: 5
Time per constraint: ~20ms
Total time: ~10,000ms (10 seconds)
Initialization: ~500ms (one-time)
```

### Optimization Strategy

1. **Run Formal Logic First** (fast failures)
2. **Skip SMT if formal logic fails** (early exit)
3. **Batch SMT constraints** (fewer solver calls)
4. **Cache Z3 context** (avoid reinitialization)
5. **Parallel validation** (multiple documents)

```typescript
// Optimized validation pipeline
async function validateDocument(docId, results) {
  // Step 1: Fast formal logic
  const logicResults = validateDocument(docId, results, LOGIC_RULES);
  const criticalFailures = logicResults.filter(r =>
    !r.satisfied && r.severity === 'error'
  );

  // Early exit on critical failures
  if (criticalFailures.length > 0) {
    return { logic: logicResults, smt: [] };
  }

  // Step 2: SMT validation (only if logic passed)
  const smtResults = await validateWithSMT(docId, results, SMT_CONSTRAINTS);

  return { logic: logicResults, smt: smtResults };
}
```

## Configuration Options

### Enable/Disable Validation Tiers

```typescript
// In App.tsx
const VALIDATION_CONFIG = {
  enableFormalLogic: true,
  enableSMT: true,
  smtTimeout: 5000,  // 5 seconds per constraint
  failFast: true     // Stop on first error
};

if (VALIDATION_CONFIG.enableFormalLogic) {
  // Run formal logic
}

if (VALIDATION_CONFIG.enableSMT && !hasCriticalErrors) {
  // Run SMT validation
}
```

### Per-Column Validation Settings

```typescript
interface Column {
  id: string;
  name: string;
  // ... other fields

  // Validation settings
  validation?: {
    skipFormalLogic?: boolean;
    skipSMT?: boolean;
    customRules?: ValidationRule[];
    customSMTConstraints?: SMTConstraint[];
  };
}
```

## Best Practices

### 1. Layer Your Constraints

Start with fast checks, progress to complex:
```
Layer 1: Existence checks (formal logic)
Layer 2: Type validation (formal logic)
Layer 3: Range bounds (SMT)
Layer 4: Multi-column math (SMT)
Layer 5: Optimization (SMT advanced)
```

### 2. Use Appropriate Severity

```typescript
severity: 'error'   // Data is invalid, blocks workflow
severity: 'warning' // Should review, but not blocking
severity: 'info'    // Informational, no action needed
```

### 3. Write Clear Error Messages

```typescript
// Bad
description: 'Check failed'

// Good
description: 'Contract term length must be between 1 and 60 months'
```

### 4. Test with Known-Good Data

```typescript
// Create test suite
const testCases = [
  { input: {...}, expectedViolations: [] },
  { input: {...}, expectedViolations: ['smt_payment_arithmetic'] }
];

testCases.forEach(testCase => {
  const results = validateWithSMT(testCase.input);
  assert.deepEqual(results.violations, testCase.expectedViolations);
});
```

## Monitoring and Analytics

### Validation Metrics

Track validation performance:
```typescript
{
  totalDocuments: 100,
  formalLogicTime: 120ms,
  smtValidationTime: 8500ms,
  violationsFound: {
    error: 5,
    warning: 12,
    info: 3
  },
  mostFrequentViolations: [
    'smt_payment_arithmetic',
    'rule_notice_period_missing'
  ]
}
```

### Quality Scoring

Calculate document quality score:
```typescript
function calculateQualityScore(violations) {
  const weights = { error: -10, warning: -2, info: -0.5 };
  const penalty = violations.reduce((sum, v) =>
    sum + weights[v.severity], 0
  );
  return Math.max(0, 100 + penalty);
}
```

## Future Enhancements

### Planned Features
- [ ] Visual rule builder UI
- [ ] LLM-powered auto-fix for violations
- [ ] Machine learning on violation patterns
- [ ] Distributed validation (worker threads)
- [ ] Real-time validation as user types
- [ ] Custom validation DSL
- [ ] Integration with external solvers (CVC5, Yices)

### Research Directions
- [ ] Probabilistic constraints with confidence scores
- [ ] Temporal logic for time-series data
- [ ] Graph constraints for relationship validation
- [ ] Neural-symbolic integration

## Conclusion

The two-tier validation system provides:

**Tier 1 (Formal Logic):**
- Fast boolean checks
- Dependency validation
- Pattern matching
- ~100ms for 100 documents

**Tier 2 (SMT with Z3):**
- Mathematical rigor
- Arithmetic constraints
- Multi-column equations
- ~10s for 100 documents

Together, they ensure LLM-extracted data is:
- ✅ Logically consistent
- ✅ Mathematically correct
- ✅ Business-rule compliant
- ✅ Production-ready

This makes Tabular Review suitable for mission-critical document analysis where data quality is paramount.
