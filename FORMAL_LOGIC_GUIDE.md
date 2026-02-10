# Formal Logic Validation System

## Overview

The Tabular Review application now includes a **formal logic validation engine** that automatically verifies extracted data against predefined business rules. This ensures logical consistency across your document extractions and catches contradictions or missing dependencies.

## How It Works

After LLM extraction completes, the system:
1. Evaluates all extracted data against formal logic rules
2. Identifies violations (errors, warnings, info)
3. Marks cells with validation failures
4. Displays detailed violation messages in the verification sidebar

## Architecture

### Core Components

**`services/formalLogic.ts`** - The validation engine with:
- First-order logic evaluator
- Predicate builders (implies, and, or, not, iff)
- Validation rule definitions
- Document validation function

**Visual Indicators:**
- 🛡️ Red shield icon in cells with validation failures
- "Logic Error" badge in verification sidebar
- Detailed violation messages in sidebar

## Rule Types

### 1. **Implication Rules** (If-Then Logic)

```typescript
implies(premise, conclusion)
```

**Example:** "If auto-renewal exists, then term length must be specified"
```typescript
{
  id: 'rule_auto_renewal_requires_term',
  name: 'Auto-Renewal → Term Length',
  description: 'If auto-renewal exists, term length must be specified',
  formula: implies(
    isYes('col_proc_auto_renewal'),
    exists('col_term_length')
  ),
  severity: 'error'
}
```

### 2. **Mutual Exclusion Rules**

```typescript
implies(A, not(B))  // A and B cannot both be true
```

**Example:** "Cannot have both unlimited liability and a liability cap"
```typescript
{
  id: 'rule_mutual_exclusion',
  formula: implies(
    isYes('col_unlimited_liability'),
    isNo('col_proc_cap_liability')
  ),
  severity: 'error'
}
```

### 3. **Conjunction Rules** (Multiple Requirements)

```typescript
implies(A, and(B, C))  // If A, then both B and C must be true
```

**Example:** "If termination for convenience, need both notice period AND reason"
```typescript
{
  formula: implies(
    isYes('col_term_convenience'),
    and(
      exists('col_notice_period'),
      exists('col_termination_reason')
    )
  )
}
```

### 4. **Disjunction Rules** (Alternative Requirements)

```typescript
implies(A, or(B, C))  // If A, then at least B or C must be true
```

**Example:** "If dispute resolution exists, must have either arbitration OR litigation venue"
```typescript
{
  formula: implies(
    exists('col_dispute_resolution'),
    or(
      isYes('col_arbitration'),
      exists('col_litigation_venue')
    )
  )
}
```

### 5. **Biconditional Rules** (If and Only If)

```typescript
iff(A, B)  // A is true if and only if B is true
```

**Example:** "Capped liability if and only if cap amount exists"
```typescript
{
  formula: iff(
    isYes('col_cap_liability'),
    exists('col_liability_amount')
  )
}
```

### 6. **Range Validation**

```typescript
inRange(colId, min, max)
```

**Example:** "Notice period must be 30-180 days"
```typescript
{
  formula: implies(
    exists('col_notice_period'),
    inRange('col_notice_period', 30, 180)
  )
}
```

### 7. **Pattern Matching**

```typescript
matches(colId, regex)
```

**Example:** "Email must match valid format"
```typescript
{
  formula: implies(
    exists('col_email'),
    matches('col_email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  )
}
```

## Built-in Predicates

### Boolean Checks
- `isYes(colId)` - Value equals "Yes"
- `isNo(colId)` - Value equals "No"
- `exists(colId)` - Value is not empty/null
- `isEmpty(colId)` - Value is empty/null

### Pattern Matching
- `matches(colId, regex)` - Value matches regex pattern
- `inRange(colId, min, max)` - Numeric value within range

### Custom Predicates
```typescript
atom('col_id', (value) => {
  // Custom validation logic
  return yourCondition(value);
})
```

## Severity Levels

- **`error`** - Critical violations that make data unusable
- **`warning`** - Issues that should be reviewed but not blocking
- **`info`** - Informational notices about data quality

## Default Contract Rules

The system includes these pre-configured rules:

1. **Auto-Renewal → Term Length** (error)
2. **Termination → Notice Period** (error)
3. **Liability Cap → Amount** (warning)
4. **Unlimited ↔ ¬Capped** (error)
5. **Capped Liability → Insurance** (info)

## Creating Custom Rules

### Example: Complex Contract Validation

```typescript
// In services/formalLogic.ts or your custom rules file

export const MY_CUSTOM_RULES: ValidationRule[] = [
  {
    id: 'rule_payment_terms',
    name: 'Payment Terms Validation',
    description: 'If upfront payment required, amount and date must be specified',
    formula: implies(
      isYes('col_upfront_payment'),
      and(
        exists('col_payment_amount'),
        exists('col_payment_date')
      )
    ),
    severity: 'error',
    autoFix: true
  },

  {
    id: 'rule_exclusivity',
    name: 'Exclusivity Period',
    description: 'Exclusive agreements must have a defined exclusivity period',
    formula: implies(
      isYes('col_exclusive'),
      and(
        exists('col_exclusivity_period'),
        inRange('col_exclusivity_months', 1, 60)
      )
    ),
    severity: 'warning',
    autoFix: false
  },

  {
    id: 'rule_data_retention',
    name: 'Data Retention Requirements',
    description: 'If PII is processed, data retention policy must be specified',
    formula: implies(
      isYes('col_processes_pii'),
      and(
        exists('col_data_retention_period'),
        exists('col_deletion_procedure')
      )
    ),
    severity: 'error',
    autoFix: true
  },

  {
    id: 'rule_jurisdiction',
    name: 'Governing Law Consistency',
    description: 'Arbitration location should match governing law jurisdiction',
    formula: implies(
      and(
        exists('col_governing_law'),
        exists('col_arbitration_location')
      ),
      atom('col_consistency', (value) => {
        // Custom logic to check jurisdiction consistency
        return true; // Implement your check
      })
    ),
    severity: 'warning',
    autoFix: false
  }
];
```

### Using Custom Rules

```typescript
// In App.tsx
import { MY_CUSTOM_RULES } from './rules/customRules';

// Replace DEFAULT_CONTRACT_RULES with your rules
const validationResults = validateDocument(doc.id, results, MY_CUSTOM_RULES);
```

## Advanced: Integrating SMT Solvers

For more complex constraints, you can integrate Z3 or other SMT solvers:

### Installation

```bash
npm install z3-solver
```

### Example: Z3 Integration

```typescript
import { init } from 'z3-solver';

async function verifyWithZ3(results: ExtractionResult, docId: string) {
  const { Context } = await init();
  const { Solver, Bool, Int } = Context('main');

  const solver = new Solver();

  // Define variables
  const autoRenewal = Bool.const('autoRenewal');
  const termLength = Int.const('termLength');

  // Add constraints
  solver.add(autoRenewal.implies(termLength.gt(0)));
  solver.add(termLength.le(60)); // Max 5 years

  // Assert extracted values
  const hasAutoRenewal = results[docId]?.['col_auto_renewal']?.value === 'Yes';
  solver.add(hasAutoRenewal ? autoRenewal : autoRenewal.not());

  // Check satisfiability
  const result = await solver.check();

  if (result === 'unsat') {
    return { valid: false, violations: solver.unsatCore() };
  }

  return { valid: true };
}
```

## Best Practices

### 1. **Start Simple**
Begin with basic implication rules before adding complex logic.

### 2. **Use Appropriate Severity**
- `error`: Data is logically invalid
- `warning`: Data should be reviewed
- `info`: Nice-to-have checks

### 3. **Test Your Rules**
Create test cases with known violations to verify rules work correctly.

### 4. **Document Business Logic**
Include clear descriptions explaining *why* each rule exists.

### 5. **Performance Considerations**
- Rules run after all extractions complete
- Complex rules with many predicates may slow validation
- Consider async validation for large document sets

## Extending the System

### Adding New Predicate Types

```typescript
// In formalLogic.ts

export const startsWith = (colId: string, prefix: string) =>
  atom(colId, v => v.startsWith(prefix));

export const containsKeyword = (colId: string, keyword: string) =>
  atom(colId, v => v.toLowerCase().includes(keyword.toLowerCase()));

export const isDate = (colId: string) =>
  atom(colId, v => !isNaN(Date.parse(v)));

export const isFutureDate = (colId: string) =>
  atom(colId, v => {
    const date = new Date(v);
    return date > new Date();
  });
```

### Cross-Document Validation

```typescript
// Validate consistency across multiple documents
export function validateProjectWide(
  results: ExtractionResult,
  documents: DocumentFile[]
): ValidationResult[] {
  const allValues = documents.map(doc =>
    results[doc.id]?.['col_governing_law']?.value
  );

  // Check if all documents have same governing law
  const uniqueValues = new Set(allValues.filter(v => v));

  if (uniqueValues.size > 1) {
    return [{
      ruleId: 'cross_doc_consistency',
      ruleName: 'Governing Law Consistency',
      satisfied: false,
      severity: 'warning',
      message: 'Documents have different governing laws',
      affectedColumns: ['col_governing_law']
    }];
  }

  return [];
}
```

## Troubleshooting

### Rules Not Triggering

1. **Check column IDs**: Ensure rule references match actual column IDs
2. **Verify predicates**: Test predicates in isolation
3. **Console logs**: Check browser console for validation results

### False Positives

1. **Adjust predicates**: Make conditions more specific
2. **Handle edge cases**: Add null checks in custom predicates
3. **Test with sample data**: Verify rules against known-good extractions

### Performance Issues

1. **Simplify complex rules**: Break down into multiple simpler rules
2. **Limit rule count**: Only validate what's necessary
3. **Use early returns**: Short-circuit evaluation in custom predicates

## Future Enhancements

Potential additions to the formal logic system:

- **LLM-powered auto-fix**: When `autoFix: true`, re-prompt LLM with violation context
- **Rule inheritance**: Define rule templates that columns inherit
- **Temporal logic**: Express rules about sequences (e.g., "start date before end date")
- **Probabilistic constraints**: Rules that account for confidence scores
- **Visual rule builder**: UI for creating rules without code
- **Rule testing framework**: Automated tests for validation rules

## Example Use Cases

### Due Diligence Review
```typescript
// Ensure all critical contract terms are present
implies(exists('col_contract_type'),
  and(
    exists('col_parties'),
    exists('col_term_length'),
    exists('col_governing_law'),
    exists('col_signatures')
  )
)
```

### Compliance Checking
```typescript
// GDPR-style data processing requirements
implies(isYes('col_processes_pii'),
  and(
    exists('col_data_controller'),
    exists('col_retention_period'),
    exists('col_deletion_rights'),
    isYes('col_encryption')
  )
)
```

### Financial Analysis
```typescript
// Payment terms validation
implies(exists('col_payment_terms'),
  and(
    inRange('col_payment_days', 0, 120),
    or(
      isYes('col_early_payment_discount'),
      isYes('col_late_payment_penalty')
    )
  )
)
```

## Conclusion

The formal logic validation system provides:
- ✅ Automated consistency checking
- ✅ Declarative rule definitions
- ✅ Visual feedback for violations
- ✅ Extensible architecture
- ✅ Integration with SMT solvers

This ensures your document extractions are not just accurate, but also logically consistent according to your business rules.
