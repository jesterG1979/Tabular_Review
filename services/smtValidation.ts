import { init, Z3HighLevel } from 'z3-solver';
import { ExtractionResult, Column, SmtRule } from '../types';

// ============================================================================
// SMT VALIDATION TYPES
// ============================================================================

export interface SMTConstraint {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  // The constraint function receives Z3 context and returns assertions
  constraint: (ctx: Z3HighLevel, vars: Record<string, any>) => any[];
  // Maps column IDs to Z3 variable types
  variableMap: Record<string, 'bool' | 'int' | 'real' | 'string'>;
  affectedColumns: string[];
}

export interface SMTValidationResult {
  constraintId: string;
  constraintName: string;
  satisfied: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedColumns: string[];
  counterExample?: Record<string, any>; // Z3 model when unsat
  explanation?: string;
}

// ============================================================================
// Z3 CONTEXT MANAGER
// ============================================================================

let z3Instance: Z3HighLevel | null = null;

async function getZ3Context(): Promise<Z3HighLevel> {
  if (!z3Instance) {
    const { Context } = await init();
    z3Instance = Context('main');
  }
  return z3Instance;
}

// ============================================================================
// VALUE PARSERS
// ============================================================================

function parseToBoolean(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}

function parseToInt(value: string): number {
  const match = value.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseToReal(value: string): number {
  // Extract numbers like "$1,000,000" or "1.5M" or "25%"
  const cleanValue = value.replace(/[$,]/g, '');

  // Handle M/K suffixes
  if (cleanValue.includes('M') || cleanValue.includes('m')) {
    return parseFloat(cleanValue.replace(/[Mm]/g, '')) * 1_000_000;
  }
  if (cleanValue.includes('K') || cleanValue.includes('k')) {
    return parseFloat(cleanValue.replace(/[Kk]/g, '')) * 1_000;
  }
  if (cleanValue.includes('%')) {
    return parseFloat(cleanValue.replace('%', '')) / 100;
  }

  return parseFloat(cleanValue) || 0;
}

// ============================================================================
// SMT VALIDATION ENGINE
// ============================================================================

export async function validateWithSMT(
  docId: string,
  results: ExtractionResult,
  constraints: SMTConstraint[]
): Promise<SMTValidationResult[]> {
  const ctx = await getZ3Context();
  const { Solver } = ctx;

  const validationResults: SMTValidationResult[] = [];
  const docResults = results[docId];

  if (!docResults) {
    return [];
  }

  for (const constraint of constraints) {
    try {
      const solver = new Solver();

      // Create Z3 variables based on constraint's variable map
      const z3Vars: Record<string, any> = {};
      const extractedValues: Record<string, any> = {};

      for (const [colId, varType] of Object.entries(constraint.variableMap)) {
        const cell = docResults[colId];
        const value = cell?.value || '';

        // Create Z3 variable
        switch (varType) {
          case 'bool':
            z3Vars[colId] = ctx.Bool.const(colId);
            extractedValues[colId] = parseToBoolean(value);
            break;
          case 'int':
            z3Vars[colId] = ctx.Int.const(colId);
            extractedValues[colId] = parseToInt(value);
            break;
          case 'real':
            z3Vars[colId] = ctx.Real.const(colId);
            extractedValues[colId] = parseToReal(value);
            break;
          case 'string':
            // Z3 string theory is complex, we'll handle as atoms
            z3Vars[colId] = ctx.Bool.const(`${colId}_exists`);
            extractedValues[colId] = value !== '' && value !== null;
            break;
        }
      }

      // Add the constraint assertions
      const assertions = constraint.constraint(ctx, z3Vars);
      assertions.forEach(assertion => solver.add(assertion));

      // Assert the extracted values
      for (const [colId, varType] of Object.entries(constraint.variableMap)) {
        const z3Var = z3Vars[colId];
        const extractedValue = extractedValues[colId];

        switch (varType) {
          case 'bool':
            solver.add(extractedValue ? z3Var : z3Var.not());
            break;
          case 'int':
            solver.add(z3Var.eq(extractedValue));
            break;
          case 'real':
            solver.add(z3Var.eq(ctx.Real.val(extractedValue)));
            break;
          case 'string':
            solver.add(extractedValue ? z3Var : z3Var.not());
            break;
        }
      }

      // Check satisfiability
      const checkResult = await solver.check();

      if (checkResult === 'sat') {
        // Constraint is satisfied
        validationResults.push({
          constraintId: constraint.id,
          constraintName: constraint.name,
          satisfied: true,
          severity: constraint.severity,
          message: `✓ ${constraint.description}`,
          affectedColumns: constraint.affectedColumns
        });
      } else {
        // Constraint violated (unsat)
        const model = checkResult === 'unknown' ? null : solver.model();
        const counterExample: Record<string, any> = {};

        if (model) {
          for (const colId of Object.keys(constraint.variableMap)) {
            const z3Var = z3Vars[colId];
            try {
              const modelValue = model.eval(z3Var);
              counterExample[colId] = modelValue.toString();
            } catch (e) {
              counterExample[colId] = 'unknown';
            }
          }
        }

        validationResults.push({
          constraintId: constraint.id,
          constraintName: constraint.name,
          satisfied: false,
          severity: constraint.severity,
          message: `✗ ${constraint.description}`,
          affectedColumns: constraint.affectedColumns,
          counterExample,
          explanation: generateExplanation(constraint, extractedValues)
        });
      }
    } catch (error) {
      console.error(`[SMT] Error validating constraint ${constraint.id}:`, error);
      validationResults.push({
        constraintId: constraint.id,
        constraintName: constraint.name,
        satisfied: false,
        severity: 'warning',
        message: `⚠ Could not validate: ${constraint.description}`,
        affectedColumns: constraint.affectedColumns,
        explanation: `SMT solver error: ${error}`
      });
    }
  }

  return validationResults;
}

function generateExplanation(
  constraint: SMTConstraint,
  values: Record<string, any>
): string {
  const valueStr = Object.entries(values)
    .map(([col, val]) => `${col}=${val}`)
    .join(', ');
  return `Given values (${valueStr}) violate constraint: ${constraint.description}`;
}

// ============================================================================
// PRE-BUILT SMT CONSTRAINTS
// ============================================================================

export const DEFAULT_SMT_CONSTRAINTS: SMTConstraint[] = [
  // Constraint 1: Term Length Bounds
  {
    id: 'smt_term_length_bounds',
    name: 'Term Length Range',
    description: 'Contract term must be between 1 and 60 months',
    severity: 'error',
    variableMap: {
      'col_term_length': 'int'
    },
    affectedColumns: ['col_term_length'],
    constraint: (ctx, vars) => {
      const termLength = vars['col_term_length'];
      return [
        termLength.ge(1),
        termLength.le(60)
      ];
    }
  },

  // Constraint 2: Notice Period Reasonableness
  {
    id: 'smt_notice_period_range',
    name: 'Notice Period Range',
    description: 'Notice period must be between 30 and 180 days',
    severity: 'warning',
    variableMap: {
      'col_notice_period': 'int'
    },
    affectedColumns: ['col_notice_period'],
    constraint: (ctx, vars) => {
      const noticePeriod = vars['col_notice_period'];
      return [
        noticePeriod.ge(30),
        noticePeriod.le(180)
      ];
    }
  },

  // Constraint 3: Auto-Renewal Logic
  {
    id: 'smt_auto_renewal_requires_term',
    name: 'Auto-Renewal → Term Length',
    description: 'If auto-renewal exists, term length must be positive',
    severity: 'error',
    variableMap: {
      'col_proc_auto_renewal': 'bool',
      'col_term_length': 'int'
    },
    affectedColumns: ['col_proc_auto_renewal', 'col_term_length'],
    constraint: (ctx, vars) => {
      const autoRenewal = vars['col_proc_auto_renewal'];
      const termLength = vars['col_term_length'];
      return [
        autoRenewal.implies(termLength.gt(0))
      ];
    }
  },

  // Constraint 4: Liability Cap Amount Logic
  {
    id: 'smt_liability_cap_amount',
    name: 'Liability Cap → Positive Amount',
    description: 'If liability is capped, cap amount must be positive',
    severity: 'error',
    variableMap: {
      'col_proc_cap_liability': 'bool',
      'col_liability_amount': 'real'
    },
    affectedColumns: ['col_proc_cap_liability', 'col_liability_amount'],
    constraint: (ctx, vars) => {
      const hasCap = vars['col_proc_cap_liability'];
      const capAmount = vars['col_liability_amount'];
      return [
        hasCap.implies(capAmount.gt(0))
      ];
    }
  },

  // Constraint 5: Multi-Column Arithmetic
  {
    id: 'smt_payment_terms_arithmetic',
    name: 'Payment Terms Consistency',
    description: 'Total payment equals upfront + recurring * term length',
    severity: 'warning',
    variableMap: {
      'col_upfront_payment': 'real',
      'col_recurring_payment': 'real',
      'col_term_length': 'int',
      'col_total_payment': 'real'
    },
    affectedColumns: ['col_upfront_payment', 'col_recurring_payment', 'col_term_length', 'col_total_payment'],
    constraint: (ctx, vars) => {
      const upfront = vars['col_upfront_payment'];
      const recurring = vars['col_recurring_payment'];
      const termLength = vars['col_term_length'];
      const total = vars['col_total_payment'];

      // total = upfront + (recurring * termLength)
      // Convert int to real for multiplication
      const termLengthReal = ctx.ToReal(termLength);
      const calculated = upfront.add(recurring.mul(termLengthReal));

      // Allow 1% tolerance for rounding
      const tolerance = total.mul(0.01);
      return [
        total.ge(calculated.sub(tolerance)),
        total.le(calculated.add(tolerance))
      ];
    }
  },

  // Constraint 6: Date Ordering
  {
    id: 'smt_date_ordering',
    name: 'Start Date < End Date',
    description: 'Contract start date must be before end date (as days since epoch)',
    severity: 'error',
    variableMap: {
      'col_start_date': 'int',
      'col_end_date': 'int'
    },
    affectedColumns: ['col_start_date', 'col_end_date'],
    constraint: (ctx, vars) => {
      const startDate = vars['col_start_date'];
      const endDate = vars['col_end_date'];
      return [
        startDate.lt(endDate)
      ];
    }
  },

  // Constraint 7: Exclusive Or (XOR) Logic
  {
    id: 'smt_payment_method_xor',
    name: 'Payment Method XOR',
    description: 'Exactly one payment method must be selected',
    severity: 'error',
    variableMap: {
      'col_payment_wire': 'bool',
      'col_payment_check': 'bool',
      'col_payment_ach': 'bool'
    },
    affectedColumns: ['col_payment_wire', 'col_payment_check', 'col_payment_ach'],
    constraint: (ctx, vars) => {
      const wire = vars['col_payment_wire'];
      const check = vars['col_payment_check'];
      const ach = vars['col_payment_ach'];

      // XOR: exactly one must be true
      // (A ∨ B ∨ C) ∧ ¬(A ∧ B) ∧ ¬(A ∧ C) ∧ ¬(B ∧ C)
      return [
        ctx.Or(wire, check, ach), // At least one
        ctx.Not(ctx.And(wire, check)), // Not both wire and check
        ctx.Not(ctx.And(wire, ach)),   // Not both wire and ach
        ctx.Not(ctx.And(check, ach))   // Not both check and ach
      ];
    }
  },

  // Constraint 8: Percentage Bounds
  {
    id: 'smt_percentage_bounds',
    name: 'Ownership Percentage',
    description: 'Ownership percentage must be between 0% and 100%',
    severity: 'error',
    variableMap: {
      'col_ownership_pct': 'real'
    },
    affectedColumns: ['col_ownership_pct'],
    constraint: (ctx, vars) => {
      const pct = vars['col_ownership_pct'];
      return [
        pct.ge(0),
        pct.le(1.0) // Assuming normalized to 0-1
      ];
    }
  },

  // Constraint 9: Insurance Minimum Based on Liability
  {
    id: 'smt_insurance_minimum',
    name: 'Insurance Coverage Minimum',
    description: 'Insurance coverage must be at least 2x liability cap',
    severity: 'warning',
    variableMap: {
      'col_proc_insurance': 'bool',
      'col_liability_amount': 'real',
      'col_insurance_amount': 'real'
    },
    affectedColumns: ['col_proc_insurance', 'col_liability_amount', 'col_insurance_amount'],
    constraint: (ctx, vars) => {
      const hasInsurance = vars['col_proc_insurance'];
      const liabilityCap = vars['col_liability_amount'];
      const insuranceAmount = vars['col_insurance_amount'];

      // If insurance required, amount must be >= 2 * liability cap
      return [
        hasInsurance.implies(
          insuranceAmount.ge(liabilityCap.mul(2))
        )
      ];
    }
  },

  // Constraint 10: Termination Notice vs Contract Term
  {
    id: 'smt_notice_vs_term',
    name: 'Notice Period vs Term Length',
    description: 'Notice period must not exceed 50% of contract term',
    severity: 'warning',
    variableMap: {
      'col_notice_period': 'int',
      'col_term_length': 'int'
    },
    affectedColumns: ['col_notice_period', 'col_term_length'],
    constraint: (ctx, vars) => {
      const noticePeriod = vars['col_notice_period'];
      const termLength = vars['col_term_length'];

      // notice_period <= term_length * 30 * 0.5 (assuming term in months, notice in days)
      const termInDays = termLength.mul(30);
      const maxNotice = termInDays.div(2);

      return [
        noticePeriod.le(maxNotice)
      ];
    }
  }
];

// ============================================================================
// CONSTRAINT BUILDER HELPERS
// ============================================================================

export class SMTConstraintBuilder {
  private constraint: Partial<SMTConstraint> = {};

  withId(id: string): this {
    this.constraint.id = id;
    return this;
  }

  withName(name: string): this {
    this.constraint.name = name;
    return this;
  }

  withDescription(description: string): this {
    this.constraint.description = description;
    return this;
  }

  withSeverity(severity: 'error' | 'warning' | 'info'): this {
    this.constraint.severity = severity;
    return this;
  }

  withVariables(variableMap: Record<string, 'bool' | 'int' | 'real' | 'string'>): this {
    this.constraint.variableMap = variableMap;
    this.constraint.affectedColumns = Object.keys(variableMap);
    return this;
  }

  withConstraint(constraintFn: (ctx: Z3HighLevel, vars: Record<string, any>) => any[]): this {
    this.constraint.constraint = constraintFn;
    return this;
  }

  build(): SMTConstraint {
    if (!this.constraint.id || !this.constraint.name || !this.constraint.description ||
      !this.constraint.severity || !this.constraint.variableMap || !this.constraint.constraint) {
      throw new Error('SMTConstraint is incomplete');
    }
    return this.constraint as SMTConstraint;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatSMTValidationReport(results: SMTValidationResult[]): string {
  const errors = results.filter(r => !r.satisfied && r.severity === 'error');
  const warnings = results.filter(r => !r.satisfied && r.severity === 'warning');
  const info = results.filter(r => !r.satisfied && r.severity === 'info');

  let report = '';

  if (errors.length > 0) {
    report += `\n❌ SMT ERRORS (${errors.length}):\n`;
    errors.forEach(e => {
      report += `  • ${e.message}\n`;
      if (e.explanation) {
        report += `    ${e.explanation}\n`;
      }
    });
  }

  if (warnings.length > 0) {
    report += `\n⚠️  SMT WARNINGS (${warnings.length}):\n`;
    warnings.forEach(w => {
      report += `  • ${w.message}\n`;
      if (w.explanation) {
        report += `    ${w.explanation}\n`;
      }
    });
  }

  if (info.length > 0) {
    report += `\nℹ️  SMT INFO (${info.length}):\n`;
    info.forEach(i => {
      report += `  • ${i.message}\n`;
    });
  }

  if (errors.length === 0 && warnings.length === 0 && info.length === 0) {
    report = '✅ All SMT constraints satisfied!';
  }

  return report;
}

// Export for easy constraint creation
export function createSMTConstraint(): SMTConstraintBuilder {
  return new SMTConstraintBuilder();
}

// ============================================================================
// DYNAMIC CONSTRAINT GENERATION
// ============================================================================

export function convertColumnRulesToConstraints(columns: Column[]): SMTConstraint[] {
  const constraints: SMTConstraint[] = [];

  for (const col of columns) {
    if (!col.smtRules || col.smtRules.length === 0) continue;

    // Only support number type for now
    if (col.type !== 'number') continue;

    for (const rule of col.smtRules) {
      constraints.push({
        id: `dynamic_${col.id}_${rule.id}`,
        name: `${col.name} Validation`,
        description: rule.description || `${col.name} check`,
        severity: 'error',
        variableMap: {
          [col.id]: 'real' // Use real for all number validations for flexibility
        },
        affectedColumns: [col.id],
        constraint: (ctx, vars) => {
          const variable = vars[col.id];
          const value = parseFloat(String(rule.value));

          // Z3 requires comparisons between Z3 expressions.
          // In high-level JS bindings, we can often compare with primitives, 
          // or create values using ctx.Real.val(value)
          // For safety, we'll try direct comparison first as Z3 JS often supports it.
          // If not, we'd need ctx.Real.val(value).

          switch (rule.operator) {
            case 'gt': return [variable.gt(value)];
            case 'lt': return [variable.lt(value)];
            case 'eq': return [variable.eq(value)];
            case 'neq': return [variable.neq(value)];
            case 'ge': return [variable.ge(value)];
            case 'le': return [variable.le(value)];
            default: return [];
          }
        }
      });
    }
  }

  return constraints;
}
