# SMT Validation with Z3 Solver

## Overview

The Tabular Review application now includes **SMT (Satisfiability Modulo Theories) validation** powered by Microsoft's Z3 theorem prover. This allows you to express and verify complex mathematical, arithmetic, and logical constraints over extracted data that go far beyond simple boolean logic.

## What is SMT?

SMT solvers can reason about:
- **Integer arithmetic**: Term lengths, payment terms, quantities
- **Real number arithmetic**: Currency amounts, percentages, ratios
- **Boolean logic**: Complex implications and exclusions
- **Date/time reasoning**: Temporal constraints
- **Multi-column relationships**: Cross-field validation

Z3 automatically finds whether your constraints are satisfiable or provides counterexamples when they're violated.

## Architecture

### Components

**`services/smtValidation.ts`** - The SMT validation engine:
- Z3 context manager
- Value parsers (string → int/real/bool)
- Constraint evaluation
- 10 pre-built SMT constraints
- Constraint builder helpers

**Integration Flow:**
1. LLM extracts data
2. Basic formal logic validation runs
3. SMT validation runs with Z3
4. Violations marked on cells
5. Detailed explanations shown in sidebar

## Pre-built SMT Constraints

### 1. **Term Length Bounds** (Integer Range)
```typescript
{
  id: 'smt_term_length_bounds',
  description: 'Contract term must be between 1 and 60 months',
  severity: 'error',
  variableMap: { 'col_term_length': 'int' },
  constraint: (ctx, vars) => [
    vars['col_term_length'].ge(1),
    vars['col_term_length'].le(60)
  ]
}
```

### 2. **Notice Period Range** (Integer Bounds)
```typescript
{
  id: 'smt_notice_period_range',
  description: 'Notice period must be between 30 and 180 days',
  severity: 'warning',
  variableMap: { 'col_notice_period': 'int' }
}
```

### 3. **Auto-Renewal Logic** (Boolean → Integer)
```typescript
{
  id: 'smt_auto_renewal_requires_term',
  description: 'If auto-renewal exists, term length must be positive',
  severity: 'error',
  variableMap: {
    'col_proc_auto_renewal': 'bool',
    'col_term_length': 'int'
  },
  constraint: (ctx, vars) => [
    vars['col_proc_auto_renewal'].implies(vars['col_term_length'].gt(0))
  ]
}
```

### 4. **Liability Cap Amount** (Boolean → Real)
```typescript
{
  id: 'smt_liability_cap_amount',
  description: 'If liability is capped, cap amount must be positive',
  severity: 'error',
  variableMap: {
    'col_proc_cap_liability': 'bool',
    'col_liability_amount': 'real'
  }
}
```

### 5. **Payment Terms Arithmetic** (Multi-Column Math)
```typescript
{
  id: 'smt_payment_terms_arithmetic',
  description: 'Total payment equals upfront + recurring * term length',
  severity: 'warning',
  variableMap: {
    'col_upfront_payment': 'real',
    'col_recurring_payment': 'real',
    'col_term_length': 'int',
    'col_total_payment': 'real'
  },
  constraint: (ctx, vars) => {
    // total = upfront + (recurring * termLength)
    const termLengthReal = ctx.ToReal(vars['col_term_length']);
    const calculated = vars['col_upfront_payment'].add(
      vars['col_recurring_payment'].mul(termLengthReal)
    );

    // Allow 1% tolerance
    const tolerance = vars['col_total_payment'].mul(0.01);
    return [
      vars['col_total_payment'].ge(calculated.sub(tolerance)),
      vars['col_total_payment'].le(calculated.add(tolerance))
    ];
  }
}
```

### 6. **Date Ordering** (Temporal Logic)
```typescript
{
  id: 'smt_date_ordering',
  description: 'Contract start date must be before end date',
  severity: 'error',
  variableMap: {
    'col_start_date': 'int',  // Days since epoch
    'col_end_date': 'int'
  },
  constraint: (ctx, vars) => [
    vars['col_start_date'].lt(vars['col_end_date'])
  ]
}
```

### 7. **Exclusive OR (XOR)** (Exactly One Selection)
```typescript
{
  id: 'smt_payment_method_xor',
  description: 'Exactly one payment method must be selected',
  severity: 'error',
  variableMap: {
    'col_payment_wire': 'bool',
    'col_payment_check': 'bool',
    'col_payment_ach': 'bool'
  },
  constraint: (ctx, vars) => {
    const { wire, check, ach } = vars;
    return [
      ctx.Or(wire, check, ach),           // At least one
      ctx.Not(ctx.And(wire, check)),      // Not multiple
      ctx.Not(ctx.And(wire, ach)),
      ctx.Not(ctx.And(check, ach))
    ];
  }
}
```

### 8. **Percentage Bounds** (Real Range with Normalization)
```typescript
{
  id: 'smt_percentage_bounds',
  description: 'Ownership percentage must be between 0% and 100%',
  severity: 'error',
  variableMap: { 'col_ownership_pct': 'real' },
  constraint: (ctx, vars) => [
    vars['col_ownership_pct'].ge(0),
    vars['col_ownership_pct'].le(1.0)  // Normalized to 0-1
  ]
}
```

### 9. **Insurance Minimum** (Proportional Constraints)
```typescript
{
  id: 'smt_insurance_minimum',
  description: 'Insurance coverage must be at least 2x liability cap',
  severity: 'warning',
  variableMap: {
    'col_proc_insurance': 'bool',
    'col_liability_amount': 'real',
    'col_insurance_amount': 'real'
  },
  constraint: (ctx, vars) => [
    vars['col_proc_insurance'].implies(
      vars['col_insurance_amount'].ge(
        vars['col_liability_amount'].mul(2)
      )
    )
  ]
}
```

### 10. **Notice vs Term Ratio** (Proportional Validation)
```typescript
{
  id: 'smt_notice_vs_term',
  description: 'Notice period must not exceed 50% of contract term',
  severity: 'warning',
  variableMap: {
    'col_notice_period': 'int',
    'col_term_length': 'int'
  },
  constraint: (ctx, vars) => {
    const termInDays = vars['col_term_length'].mul(30);
    const maxNotice = termInDays.div(2);
    return [vars['col_notice_period'].le(maxNotice)];
  }
}
```

## Creating Custom SMT Constraints

### Using the Constraint Builder

```typescript
import { createSMTConstraint } from './services/smtValidation';

const myConstraint = createSMTConstraint()
  .withId('my_custom_constraint')
  .withName('Revenue Growth Validation')
  .withDescription('Year-over-year revenue growth must be positive')
  .withSeverity('warning')
  .withVariables({
    'col_revenue_y1': 'real',
    'col_revenue_y2': 'real'
  })
  .withConstraint((ctx, vars) => {
    const y1 = vars['col_revenue_y1'];
    const y2 = vars['col_revenue_y2'];

    // Y2 revenue must be > Y1 revenue
    return [y2.gt(y1)];
  })
  .build();
```

### Advanced Examples

#### 1. Debt-to-Equity Ratio
```typescript
createSMTConstraint()
  .withId('debt_equity_ratio')
  .withName('Debt-to-Equity Ratio')
  .withDescription('Total debt / equity must be <= 2.0 (healthy balance sheet)')
  .withSeverity('warning')
  .withVariables({
    'col_total_debt': 'real',
    'col_total_equity': 'real'
  })
  .withConstraint((ctx, vars) => {
    const debt = vars['col_total_debt'];
    const equity = vars['col_total_equity'];

    // debt/equity <= 2.0
    // Rewritten as: debt <= 2.0 * equity
    return [
      equity.gt(0),  // Equity must be positive
      debt.le(equity.mul(2.0))
    ];
  })
  .build();
```

#### 2. Date Range with Duration
```typescript
createSMTConstraint()
  .withId('contract_duration_check')
  .withName('Contract Duration Consistency')
  .withDescription('End date - start date must equal stated term length')
  .withSeverity('error')
  .withVariables({
    'col_start_date': 'int',    // Days since epoch
    'col_end_date': 'int',
    'col_term_months': 'int'
  })
  .withConstraint((ctx, vars) => {
    const start = vars['col_start_date'];
    const end = vars['col_end_date'];
    const termMonths = vars['col_term_months'];

    // Duration in days
    const actualDuration = end.sub(start);

    // Expected duration (months * 30)
    const expectedDuration = termMonths.mul(30);

    // Allow 5-day tolerance for month variations
    const tolerance = 5;
    return [
      actualDuration.ge(expectedDuration.sub(tolerance)),
      actualDuration.le(expectedDuration.add(tolerance))
    ];
  })
  .build();
```

#### 3. Discount Validation
```typescript
createSMTConstraint()
  .withId('discount_validation')
  .withName('Discount Consistency')
  .withDescription('Discounted price = original price * (1 - discount rate)')
  .withSeverity('error')
  .withVariables({
    'col_original_price': 'real',
    'col_discount_rate': 'real',     // 0-1 (e.g., 0.15 = 15%)
    'col_final_price': 'real'
  })
  .withConstraint((ctx, vars) => {
    const original = vars['col_original_price'];
    const discountRate = vars['col_discount_rate'];
    const final = vars['col_final_price'];

    // final = original * (1 - discountRate)
    const oneMinusDiscount = ctx.Real.val(1).sub(discountRate);
    const expected = original.mul(oneMinusDiscount);

    // 1% tolerance
    const tolerance = final.mul(0.01);

    return [
      discountRate.ge(0),
      discountRate.le(1),
      final.ge(expected.sub(tolerance)),
      final.le(expected.add(tolerance))
    ];
  })
  .build();
```

#### 4. Voting Threshold
```typescript
createSMTConstraint()
  .withId('voting_threshold')
  .withName('Supermajority Voting')
  .withDescription('Approval votes must be >= 67% of total votes')
  .withSeverity('error')
  .withVariables({
    'col_votes_for': 'int',
    'col_votes_against': 'int',
    'col_votes_abstain': 'int',
    'col_passed': 'bool'
  })
  .withConstraint((ctx, vars) => {
    const votesFor = vars['col_votes_for'];
    const votesAgainst = vars['col_votes_against'];
    const votesAbstain = vars['col_votes_abstain'];
    const passed = vars['col_passed'];

    const totalVotes = votesFor.add(votesAgainst).add(votesAbstain);

    // Convert to real for division
    const votesForReal = ctx.ToReal(votesFor);
    const totalVotesReal = ctx.ToReal(totalVotes);

    // votesFor / totalVotes >= 0.67
    // Rewritten: votesFor * 100 >= totalVotes * 67
    const votesForScaled = votesFor.mul(100);
    const threshold = totalVotes.mul(67);

    return [
      totalVotes.gt(0),  // Must have votes
      passed.iff(votesForScaled.ge(threshold))
    ];
  })
  .build();
```

#### 5. Multi-Year Revenue Growth
```typescript
createSMTConstraint()
  .withId('revenue_trend')
  .withName('Consistent Revenue Growth')
  .withDescription('Revenue must increase each year by at least 5%')
  .withSeverity('warning')
  .withVariables({
    'col_revenue_2022': 'real',
    'col_revenue_2023': 'real',
    'col_revenue_2024': 'real'
  })
  .withConstraint((ctx, vars) => {
    const r2022 = vars['col_revenue_2022'];
    const r2023 = vars['col_revenue_2023'];
    const r2024 = vars['col_revenue_2024'];

    // Each year must be >= 1.05 * previous year
    return [
      r2023.ge(r2022.mul(1.05)),
      r2024.ge(r2023.mul(1.05))
    ];
  })
  .build();
```

## Value Parsing

The system automatically parses extracted string values:

### Boolean Parsing
```typescript
"Yes" → true
"No" → false
"true" → true
"1" → true
```

### Integer Parsing
```typescript
"24 months" → 24
"$1,000" → 1000
"30 days" → 30
```

### Real Number Parsing
```typescript
"$1,000,000" → 1000000.0
"1.5M" → 1500000.0
"25K" → 25000.0
"15%" → 0.15
```

## Integration

### Using Custom Constraints

```typescript
// In App.tsx
import { MY_CUSTOM_SMT_CONSTRAINTS } from './constraints/customSMT';

// Replace DEFAULT_SMT_CONSTRAINTS
const smtResults = await validateWithSMT(
  doc.id,
  results,
  MY_CUSTOM_SMT_CONSTRAINTS
);
```

### Column-Level Constraints

Associate constraints with specific columns:

```typescript
// In Column type
interface Column {
  // ... existing fields
  smtConstraints?: SMTConstraint[];
}

// When creating a column
const column: Column = {
  id: 'col_revenue',
  name: 'Annual Revenue',
  type: 'number',
  prompt: 'Extract the annual revenue',
  smtConstraints: [revenueGrowthConstraint]
};
```

## Advantages Over Basic Logic

| Feature | Basic Logic | SMT (Z3) |
|---------|------------|----------|
| Arithmetic | ❌ No | ✅ Full arithmetic |
| Real numbers | ❌ No | ✅ Rational/real arithmetic |
| Optimization | ❌ No | ✅ Can find optimal values |
| Counterexamples | ❌ No | ✅ Automatic counterexamples |
| Quantifiers | ❌ No | ✅ ∀ and ∃ |
| Theories | ❌ No | ✅ Arrays, bitvectors, etc. |

## Performance Considerations

### Z3 Initialization
- Z3 context is initialized once and reused
- First validation may take ~500ms
- Subsequent validations are fast (<50ms per document)

### Constraint Complexity
- Simple constraints (range checks): ~1-5ms
- Arithmetic constraints: ~5-20ms
- Complex multi-column constraints: ~20-100ms

### Optimization Tips

1. **Group related constraints** to reduce solver calls
2. **Use appropriate types**: Prefer `int` over `real` when possible
3. **Limit constraint scope**: Only validate relevant columns
4. **Cache results**: Store validation results for unchanged data

## Debugging SMT Constraints

### Enable Verbose Logging

```typescript
// In smtValidation.ts
console.log('[SMT] Constraint:', constraint.name);
console.log('[SMT] Variables:', extractedValues);
console.log('[SMT] Z3 Result:', checkResult);
console.log('[SMT] Model:', model?.sexpr());
```

### Test Constraints Independently

```typescript
import { validateWithSMT, createSMTConstraint } from './services/smtValidation';

// Create test data
const testResults: ExtractionResult = {
  'doc1': {
    'col_term_length': { value: '24', confidence: 'High', /* ... */ }
  }
};

// Test single constraint
const result = await validateWithSMT('doc1', testResults, [myConstraint]);
console.log(result);
```

### Understanding Counterexamples

When a constraint fails, Z3 provides a counterexample showing what values would satisfy it:

```typescript
{
  constraintId: 'smt_payment_terms_arithmetic',
  satisfied: false,
  counterExample: {
    'col_upfront_payment': '5000',
    'col_recurring_payment': '1000',
    'col_term_length': '12',
    'col_total_payment': '17000'  // Should be 17000, is 15000
  },
  explanation: 'Given values (upfront=5000, recurring=1000, term=12, total=15000) violate constraint: Total payment equals upfront + recurring * term length'
}
```

## Common Patterns

### Pattern 1: Sanity Bounds
```typescript
// All numeric fields should be non-negative
createSMTConstraint()
  .withVariables({ 'col_amount': 'real' })
  .withConstraint((ctx, vars) => [vars['col_amount'].ge(0)])
```

### Pattern 2: Sum Validation
```typescript
// Part A + Part B must equal Total
createSMTConstraint()
  .withVariables({
    'col_part_a': 'real',
    'col_part_b': 'real',
    'col_total': 'real'
  })
  .withConstraint((ctx, vars) => [
    vars['col_total'].eq(vars['col_part_a'].add(vars['col_part_b']))
  ])
```

### Pattern 3: Conditional Requirements
```typescript
// If A, then B must be within range
createSMTConstraint()
  .withVariables({
    'col_has_feature': 'bool',
    'col_feature_value': 'int'
  })
  .withConstraint((ctx, vars) => [
    vars['col_has_feature'].implies(
      ctx.And(
        vars['col_feature_value'].ge(10),
        vars['col_feature_value'].le(100)
      )
    )
  ])
```

## Future Enhancements

- **Array theory**: Validate lists and collections
- **Bitvector theory**: For bit-level constraints
- **String theory**: Pattern matching in Z3
- **Optimization**: Use Z3 Optimize to find best values
- **Incremental solving**: Reuse solver state across documents
- **Parallel validation**: Run Z3 on multiple documents concurrently

## Troubleshooting

### Z3 Not Loading
```bash
# Reinstall z3-solver
npm uninstall z3-solver
npm install z3-solver

# Check installation
node -e "require('z3-solver').init().then(() => console.log('OK'))"
```

### Constraint Always Fails
- Check variable types match extracted data format
- Verify value parsing logic
- Test constraint with known-good data
- Add debug logging to see Z3 assertions

### Performance Issues
- Reduce constraint complexity
- Use timeouts on solver.check()
- Consider caching validation results
- Profile which constraints are slow

## Conclusion

SMT validation with Z3 provides:
- ✅ Mathematical rigor
- ✅ Automatic verification
- ✅ Counterexample generation
- ✅ Complex multi-column constraints
- ✅ Arithmetic and real number support
- ✅ Scalable to large document sets

Combined with basic formal logic, you now have a powerful two-tier validation system that ensures both logical consistency and mathematical correctness.
