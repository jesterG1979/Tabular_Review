import { ExtractionResult, Column } from '../types';

// ============================================================================
// FORMAL LOGIC TYPES
// ============================================================================

export type LogicExpression =
  | { type: 'atom'; colId: string; predicate: (value: string) => boolean }
  | { type: 'and'; left: LogicExpression; right: LogicExpression }
  | { type: 'or'; left: LogicExpression; right: LogicExpression }
  | { type: 'implies'; premise: LogicExpression; conclusion: LogicExpression }
  | { type: 'not'; operand: LogicExpression }
  | { type: 'iff'; left: LogicExpression; right: LogicExpression };

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  formula: LogicExpression;
  severity: 'error' | 'warning' | 'info';
  autoFix?: boolean; // If true, attempt LLM-based correction
}

export interface ValidationResult {
  ruleId: string;
  ruleName: string;
  satisfied: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedColumns: string[];
}

// ============================================================================
// HELPER FUNCTIONS FOR BUILDING FORMULAS
// ============================================================================

export const atom = (colId: string, predicate: (value: string) => boolean): LogicExpression => ({
  type: 'atom',
  colId,
  predicate
});

// Common predicates
export const isYes = (colId: string) => atom(colId, v => v === 'Yes');
export const isNo = (colId: string) => atom(colId, v => v === 'No');
export const exists = (colId: string) => atom(colId, v => v !== '' && v !== null && v !== undefined);
export const isEmpty = (colId: string) => atom(colId, v => v === '' || v === null || v === undefined);
export const matches = (colId: string, regex: RegExp) => atom(colId, v => regex.test(v));
export const inRange = (colId: string, min: number, max: number) =>
  atom(colId, v => {
    const num = parseFloat(v);
    return !isNaN(num) && num >= min && num <= max;
  });

export const and = (left: LogicExpression, right: LogicExpression): LogicExpression => ({
  type: 'and',
  left,
  right
});

export const or = (left: LogicExpression, right: LogicExpression): LogicExpression => ({
  type: 'or',
  left,
  right
});

export const implies = (premise: LogicExpression, conclusion: LogicExpression): LogicExpression => ({
  type: 'implies',
  premise,
  conclusion
});

export const not = (operand: LogicExpression): LogicExpression => ({
  type: 'not',
  operand
});

export const iff = (left: LogicExpression, right: LogicExpression): LogicExpression => ({
  type: 'iff',
  left,
  right
});

// ============================================================================
// EVALUATION ENGINE
// ============================================================================

function evaluateExpression(
  expr: LogicExpression,
  results: Record<string, string | null>
): boolean {
  switch (expr.type) {
    case 'atom': {
      const value = results[expr.colId];
      if (value === null || value === undefined) return false;
      return expr.predicate(value);
    }

    case 'and':
      return evaluateExpression(expr.left, results) && evaluateExpression(expr.right, results);

    case 'or':
      return evaluateExpression(expr.left, results) || evaluateExpression(expr.right, results);

    case 'implies': {
      const premiseHolds = evaluateExpression(expr.premise, results);
      const conclusionHolds = evaluateExpression(expr.conclusion, results);
      // p → q is equivalent to ¬p ∨ q
      return !premiseHolds || conclusionHolds;
    }

    case 'not':
      return !evaluateExpression(expr.operand, results);

    case 'iff': {
      const leftHolds = evaluateExpression(expr.left, results);
      const rightHolds = evaluateExpression(expr.right, results);
      // p ↔ q is (p → q) ∧ (q → p)
      return leftHolds === rightHolds;
    }
  }
}

// Extract all column IDs referenced in a formula
function getAffectedColumns(expr: LogicExpression): string[] {
  switch (expr.type) {
    case 'atom':
      return [expr.colId];

    case 'and':
    case 'or':
    case 'implies':
    case 'iff':
      return [...getAffectedColumns(expr.left), ...getAffectedColumns(expr.right)];

    case 'not':
      return getAffectedColumns(expr.operand);
  }
}

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

export function validateDocument(
  docId: string,
  results: ExtractionResult,
  rules: ValidationRule[]
): ValidationResult[] {
  const docResults = results[docId];
  if (!docResults) return [];

  // Convert to simpler format: colId -> value
  const valueMap: Record<string, string | null> = {};
  for (const [colId, cell] of Object.entries(docResults)) {
    valueMap[colId] = cell?.value ?? null;
  }

  // Evaluate each rule
  return rules.map(rule => {
    const satisfied = evaluateExpression(rule.formula, valueMap);

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      satisfied,
      severity: rule.severity,
      message: satisfied
        ? `✓ ${rule.description}`
        : `✗ ${rule.description}`,
      affectedColumns: getAffectedColumns(rule.formula)
    };
  });
}

// ============================================================================
// EXAMPLE RULES (Can be moved to separate config file)
// ============================================================================

export const DEFAULT_CONTRACT_RULES: ValidationRule[] = [
  {
    id: 'rule_auto_renewal_requires_term',
    name: 'Auto-Renewal → Term Length',
    description: 'If auto-renewal exists, term length must be specified',
    formula: implies(
      isYes('col_proc_auto_renewal'),
      exists('col_term_length')
    ),
    severity: 'error',
    autoFix: true
  },
  {
    id: 'rule_termination_requires_notice',
    name: 'Termination → Notice Period',
    description: 'If termination for convenience exists, notice period must be specified',
    formula: implies(
      isYes('col_proc_term_convenience'),
      exists('col_notice_period')
    ),
    severity: 'error',
    autoFix: true
  },
  {
    id: 'rule_liability_cap_requires_amount',
    name: 'Liability Cap → Amount',
    description: 'If liability is capped, the cap amount must be specified',
    formula: implies(
      isYes('col_proc_cap_liability'),
      exists('col_liability_amount')
    ),
    severity: 'warning',
    autoFix: true
  },
  {
    id: 'rule_mutual_exclusion_unlimited_cap',
    name: 'Unlimited Liability ↔ ¬Capped',
    description: 'Cannot have both unlimited liability and a liability cap',
    formula: implies(
      isYes('col_unlimited_liability'),
      isNo('col_proc_cap_liability')
    ),
    severity: 'error',
    autoFix: false
  },
  {
    id: 'rule_insurance_with_cap',
    name: 'Capped Liability → Insurance',
    description: 'If liability is capped, insurance requirement should be specified',
    formula: implies(
      isYes('col_proc_cap_liability'),
      exists('col_proc_insurance')
    ),
    severity: 'info',
    autoFix: false
  }
];

// ============================================================================
// UTILITIES
// ============================================================================

export function formatValidationReport(results: ValidationResult[]): string {
  const errors = results.filter(r => !r.satisfied && r.severity === 'error');
  const warnings = results.filter(r => !r.satisfied && r.severity === 'warning');
  const info = results.filter(r => !r.satisfied && r.severity === 'info');

  let report = '';

  if (errors.length > 0) {
    report += `\n❌ ERRORS (${errors.length}):\n`;
    errors.forEach(e => report += `  • ${e.message}\n`);
  }

  if (warnings.length > 0) {
    report += `\n⚠️  WARNINGS (${warnings.length}):\n`;
    warnings.forEach(w => report += `  • ${w.message}\n`);
  }

  if (info.length > 0) {
    report += `\nℹ️  INFO (${info.length}):\n`;
    info.forEach(i => report += `  • ${i.message}\n`);
  }

  if (errors.length === 0 && warnings.length === 0 && info.length === 0) {
    report = '✅ All validation rules passed!';
  }

  return report;
}
