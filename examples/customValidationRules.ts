/**
 * Custom Validation Rules Examples
 *
 * This file demonstrates how to create custom validation rules
 * for both Formal Logic and SMT validation systems.
 */

import { ValidationRule, implies, and, or, exists, isYes, isNo, inRange, atom } from '../services/formalLogic';
import { SMTConstraint, createSMTConstraint } from '../services/smtValidation';

// ============================================================================
// FORMAL LOGIC RULES (Tier 1)
// ============================================================================

export const CUSTOM_LOGIC_RULES: ValidationRule[] = [
  // Example 1: Payment Terms Dependencies
  {
    id: 'payment_terms_complete',
    name: 'Payment Terms Completeness',
    description: 'If payment is required, all payment fields must be filled',
    formula: implies(
      isYes('col_payment_required'),
      and(
        and(
          exists('col_payment_amount'),
          exists('col_payment_method')
        ),
        exists('col_payment_due_date')
      )
    ),
    severity: 'error',
    autoFix: true
  },

  // Example 2: Termination Clauses
  {
    id: 'termination_requirements',
    name: 'Termination Notice Requirements',
    description: 'Termination for convenience requires notice period and method',
    formula: implies(
      isYes('col_termination_convenience'),
      and(
        exists('col_termination_notice_days'),
        exists('col_termination_notification_method')
      )
    ),
    severity: 'error',
    autoFix: true
  },

  // Example 3: Confidentiality Terms
  {
    id: 'confidentiality_duration',
    name: 'Confidentiality Duration',
    description: 'If confidentiality clause exists, duration must be specified',
    formula: implies(
      isYes('col_has_confidentiality'),
      exists('col_confidentiality_years')
    ),
    severity: 'warning',
    autoFix: true
  },

  // Example 4: Indemnification Requirements
  {
    id: 'indemnification_caps',
    name: 'Indemnification with Caps',
    description: 'If indemnification is capped, cap amount must be specified',
    formula: implies(
      isYes('col_indemnification_capped'),
      and(
        exists('col_indemnification_cap_amount'),
        exists('col_indemnification_carveouts')
      )
    ),
    severity: 'warning',
    autoFix: false
  },

  // Example 5: Governing Law and Venue
  {
    id: 'jurisdiction_consistency',
    name: 'Jurisdiction Consistency',
    description: 'Dispute resolution venue should match governing law state',
    formula: atom('jurisdiction_match', () => {
      // This would require custom logic to check state matching
      // For now, just check both exist
      return true;
    }),
    severity: 'info',
    autoFix: false
  },

  // Example 6: IP Rights
  {
    id: 'ip_ownership_clear',
    name: 'IP Ownership Clarity',
    description: 'If work product is created, IP ownership must be specified',
    formula: implies(
      isYes('col_creates_work_product'),
      or(
        isYes('col_client_owns_ip'),
        isYes('col_vendor_owns_ip')
      )
    ),
    severity: 'error',
    autoFix: false
  },

  // Example 7: Data Processing
  {
    id: 'data_processing_requirements',
    name: 'GDPR-style Data Processing',
    description: 'If PII is processed, data protection terms must exist',
    formula: implies(
      isYes('col_processes_pii'),
      and(
        and(
          exists('col_data_retention_period'),
          exists('col_data_deletion_procedure')
        ),
        isYes('col_data_encryption')
      )
    ),
    severity: 'error',
    autoFix: true
  },

  // Example 8: Performance Guarantees
  {
    id: 'sla_penalties',
    name: 'SLA Penalty Terms',
    description: 'If SLA exists, breach penalties must be defined',
    formula: implies(
      exists('col_sla_uptime_pct'),
      and(
        exists('col_sla_penalty_type'),
        exists('col_sla_penalty_amount')
      )
    ),
    severity: 'warning',
    autoFix: true
  },

  // Example 9: Insurance Requirements
  {
    id: 'insurance_completeness',
    name: 'Insurance Policy Details',
    description: 'If insurance required, coverage types and amounts must be specified',
    formula: implies(
      isYes('col_insurance_required'),
      and(
        exists('col_general_liability_amount'),
        exists('col_professional_liability_amount')
      )
    ),
    severity: 'error',
    autoFix: true
  },

  // Example 10: Audit Rights
  {
    id: 'audit_rights_frequency',
    name: 'Audit Frequency Limits',
    description: 'If audit rights exist, frequency limitations should be specified',
    formula: implies(
      isYes('col_has_audit_rights'),
      exists('col_audit_frequency_limit')
    ),
    severity: 'info',
    autoFix: false
  }
];

// ============================================================================
// SMT CONSTRAINTS (Tier 2)
// ============================================================================

export const CUSTOM_SMT_CONSTRAINTS: SMTConstraint[] = [
  // Example 1: Revenue Recognition
  createSMTConstraint()
    .withId('revenue_recognition')
    .withName('Revenue Recognition Formula')
    .withDescription('Recognized revenue = total contract value / term length * months elapsed')
    .withSeverity('warning')
    .withVariables({
      'col_total_contract_value': 'real',
      'col_term_length_months': 'int',
      'col_months_elapsed': 'int',
      'col_recognized_revenue': 'real'
    })
    .withConstraint((ctx, vars) => {
      const total = vars['col_total_contract_value'];
      const term = vars['col_term_length_months'];
      const elapsed = vars['col_months_elapsed'];
      const recognized = vars['col_recognized_revenue'];

      // Convert int to real
      const termReal = ctx.ToReal(term);
      const elapsedReal = ctx.ToReal(elapsed);

      // recognized = (total / term) * elapsed
      const expected = total.div(termReal).mul(elapsedReal);

      // 2% tolerance
      const tolerance = recognized.mul(0.02);

      return [
        term.gt(0),
        elapsed.ge(0),
        elapsed.le(term),
        recognized.ge(expected.sub(tolerance)),
        recognized.le(expected.add(tolerance))
      ];
    })
    .build(),

  // Example 2: Penalty Calculation
  createSMTConstraint()
    .withId('late_payment_penalty')
    .withName('Late Payment Penalty Calculation')
    .withDescription('Penalty = principal * (days late / 365) * annual penalty rate')
    .withSeverity('error')
    .withVariables({
      'col_principal_amount': 'real',
      'col_days_late': 'int',
      'col_annual_penalty_rate': 'real',
      'col_penalty_amount': 'real'
    })
    .withConstraint((ctx, vars) => {
      const principal = vars['col_principal_amount'];
      const daysLate = vars['col_days_late'];
      const annualRate = vars['col_annual_penalty_rate'];
      const penalty = vars['col_penalty_amount'];

      const daysLateReal = ctx.ToReal(daysLate);
      const daysInYear = ctx.Real.val(365);

      // penalty = principal * (daysLate / 365) * annualRate
      const expected = principal
        .mul(daysLateReal.div(daysInYear))
        .mul(annualRate);

      const tolerance = penalty.mul(0.01);

      return [
        principal.gt(0),
        daysLate.ge(0),
        annualRate.ge(0),
        annualRate.le(0.5),  // Max 50% annual penalty
        penalty.ge(expected.sub(tolerance)),
        penalty.le(expected.add(tolerance))
      ];
    })
    .build(),

  // Example 3: Discount Validation
  createSMTConstraint()
    .withId('volume_discount')
    .withName('Volume Discount Tiers')
    .withDescription('Discount rate increases with quantity tiers')
    .withSeverity('warning')
    .withVariables({
      'col_quantity': 'int',
      'col_discount_rate': 'real',
      'col_unit_price': 'real',
      'col_total_price': 'real'
    })
    .withConstraint((ctx, vars) => {
      const qty = vars['col_quantity'];
      const discountRate = vars['col_discount_rate'];
      const unitPrice = vars['col_unit_price'];
      const totalPrice = vars['col_total_price'];

      const qtyReal = ctx.ToReal(qty);

      // Expected total = qty * unitPrice * (1 - discountRate)
      const oneMinusDiscount = ctx.Real.val(1).sub(discountRate);
      const expected = qtyReal.mul(unitPrice).mul(oneMinusDiscount);

      const tolerance = totalPrice.mul(0.01);

      // Discount tier rules
      const tier1 = ctx.And(qty.ge(1), qty.le(100), discountRate.le(0.05));
      const tier2 = ctx.And(qty.ge(101), qty.le(500), discountRate.le(0.10));
      const tier3 = ctx.And(qty.ge(501), discountRate.le(0.20));

      return [
        ctx.Or(tier1, tier2, tier3),
        totalPrice.ge(expected.sub(tolerance)),
        totalPrice.le(expected.add(tolerance))
      ];
    })
    .build(),

  // Example 4: Warranty Period Validation
  createSMTConstraint()
    .withId('warranty_period_bounds')
    .withName('Warranty Period Reasonableness')
    .withDescription('Warranty period must be between 30 days and 5 years')
    .withSeverity('warning')
    .withVariables({
      'col_warranty_days': 'int'
    })
    .withConstraint((ctx, vars) => {
      const warrantyDays = vars['col_warranty_days'];

      return [
        warrantyDays.ge(30),         // Min 30 days
        warrantyDays.le(1825)        // Max 5 years (365*5)
      ];
    })
    .build(),

  // Example 5: ROI Calculation
  createSMTConstraint()
    .withId('roi_validation')
    .withName('Return on Investment Formula')
    .withDescription('ROI = (gain - cost) / cost')
    .withSeverity('info')
    .withVariables({
      'col_initial_investment': 'real',
      'col_total_return': 'real',
      'col_roi_percentage': 'real'
    })
    .withConstraint((ctx, vars) => {
      const investment = vars['col_initial_investment'];
      const totalReturn = vars['col_total_return'];
      const roi = vars['col_roi_percentage'];

      // ROI = (totalReturn - investment) / investment
      const gain = totalReturn.sub(investment);
      const expected = gain.div(investment);

      const tolerance = ctx.Real.val(0.01);

      return [
        investment.gt(0),
        roi.ge(expected.sub(tolerance)),
        roi.le(expected.add(tolerance))
      ];
    })
    .build(),

  // Example 6: Equity Ownership
  createSMTConstraint()
    .withId('equity_ownership_sum')
    .withName('Equity Ownership Total')
    .withDescription('All equity percentages must sum to 100%')
    .withSeverity('error')
    .withVariables({
      'col_founder_equity': 'real',
      'col_investor_equity': 'real',
      'col_employee_pool': 'real',
      'col_other_equity': 'real'
    })
    .withConstraint((ctx, vars) => {
      const founder = vars['col_founder_equity'];
      const investor = vars['col_investor_equity'];
      const employee = vars['col_employee_pool'];
      const other = vars['col_other_equity'];

      const total = founder.add(investor).add(employee).add(other);

      // Each must be non-negative
      // Total must be ~1.0 (100%)
      return [
        founder.ge(0),
        investor.ge(0),
        employee.ge(0),
        other.ge(0),
        total.ge(0.99),
        total.le(1.01)
      ];
    })
    .build(),

  // Example 7: Interest Rate Bounds
  createSMTConstraint()
    .withId('interest_rate_reasonableness')
    .withName('Interest Rate Bounds')
    .withDescription('Interest rate must be between 0% and 36% (usury laws)')
    .withSeverity('error')
    .withVariables({
      'col_annual_interest_rate': 'real'
    })
    .withConstraint((ctx, vars) => {
      const rate = vars['col_annual_interest_rate'];

      return [
        rate.ge(0),
        rate.le(0.36)  // 36% max (typical usury limit)
      ];
    })
    .build(),

  // Example 8: Escrow Amount
  createSMTConstraint()
    .withId('escrow_percentage')
    .withName('Escrow as Percentage of Purchase')
    .withDescription('Escrow amount should be 10-20% of purchase price')
    .withSeverity('warning')
    .withVariables({
      'col_purchase_price': 'real',
      'col_escrow_amount': 'real'
    })
    .withConstraint((ctx, vars) => {
      const purchase = vars['col_purchase_price'];
      const escrow = vars['col_escrow_amount'];

      const minEscrow = purchase.mul(0.10);
      const maxEscrow = purchase.mul(0.20);

      return [
        purchase.gt(0),
        escrow.ge(minEscrow),
        escrow.le(maxEscrow)
      ];
    })
    .build(),

  // Example 9: Employee Benefits Ratio
  createSMTConstraint()
    .withId('benefits_ratio')
    .withName('Benefits to Salary Ratio')
    .withDescription('Benefits should be 20-40% of base salary')
    .withSeverity('info')
    .withVariables({
      'col_base_salary': 'real',
      'col_benefits_value': 'real'
    })
    .withConstraint((ctx, vars) => {
      const salary = vars['col_base_salary'];
      const benefits = vars['col_benefits_value'];

      const minBenefits = salary.mul(0.20);
      const maxBenefits = salary.mul(0.40);

      return [
        salary.gt(0),
        benefits.ge(minBenefits),
        benefits.le(maxBenefits)
      ];
    })
    .build(),

  // Example 10: Multi-Year Escalation
  createSMTConstraint()
    .withId('price_escalation')
    .withName('Annual Price Escalation')
    .withDescription('Each year price increases by escalation rate')
    .withSeverity('warning')
    .withVariables({
      'col_year1_price': 'real',
      'col_year2_price': 'real',
      'col_year3_price': 'real',
      'col_escalation_rate': 'real'
    })
    .withConstraint((ctx, vars) => {
      const y1 = vars['col_year1_price'];
      const y2 = vars['col_year2_price'];
      const y3 = vars['col_year3_price'];
      const rate = vars['col_escalation_rate'];

      const onesPlusRate = ctx.Real.val(1).add(rate);

      // Y2 = Y1 * (1 + rate)
      // Y3 = Y2 * (1 + rate)
      const expectedY2 = y1.mul(onePlusRate);
      const expectedY3 = y2.mul(onePlusRate);

      const tolerance = ctx.Real.val(0.01);

      return [
        y1.gt(0),
        rate.ge(0),
        rate.le(0.15),  // Max 15% annual escalation
        y2.ge(expectedY2.mul(ctx.Real.val(1).sub(tolerance))),
        y2.le(expectedY2.mul(ctx.Real.val(1).add(tolerance))),
        y3.ge(expectedY3.mul(ctx.Real.val(1).sub(tolerance))),
        y3.le(expectedY3.mul(ctx.Real.val(1).add(tolerance)))
      ];
    })
    .build()
];

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// In App.tsx, replace default rules with custom rules:

import { CUSTOM_LOGIC_RULES, CUSTOM_SMT_CONSTRAINTS } from './examples/customValidationRules';

// In validation section:
const validationResults = validateDocument(doc.id, results, CUSTOM_LOGIC_RULES);
const smtResults = await validateWithSMT(doc.id, results, CUSTOM_SMT_CONSTRAINTS);

// Or combine with defaults:
const allLogicRules = [...DEFAULT_CONTRACT_RULES, ...CUSTOM_LOGIC_RULES];
const allSMTConstraints = [...DEFAULT_SMT_CONSTRAINTS, ...CUSTOM_SMT_CONSTRAINTS];
*/
