const { Pool } = require('pg');
const crypto = require('crypto');

const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  STAFF: 'staff',
  FINANCE: 'finance'
};

const STATUS = {
  QUOTATION: {
    DRAFT: 'draft',
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REVISION: 'revision',
    SENT: 'sent',
    ACCEPTED: 'accepted'
  },
  LPO: {
    DRAFT: 'draft',
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    SENT: 'sent',
    AWAITING_DELIVERY: 'awaiting_delivery',
    PARTIALLY_RECEIVED: 'partially_received',
    RECEIVED: 'received'
  },
  GRN: {
    DRAFT: 'draft',
    CONFIRMED: 'confirmed'
  },
  INVOICE: {
    DRAFT: 'draft',
    UNPAID: 'unpaid',
    PARTIAL: 'partial',
    PAID: 'paid',
    OVERDUE: 'overdue'
  }
};

const STATUS_TRANSITIONS = {
  quotation: {
    draft: ['pending'],
    pending: ['approved', 'rejected', 'revision'],
    approved: ['sent'],
    rejected: ['pending'],
    revision: ['pending'],
    sent: ['accepted'],
    accepted: []
  },
  lpo: {
    draft: ['pending'],
    pending: ['approved', 'rejected'],
    approved: ['sent', 'awaiting_delivery'],
    rejected: ['pending'],
    sent: ['awaiting_delivery'],
    awaiting_delivery: ['partially_received', 'received'],
    partially_received: ['received'],
    received: []
  },
  grn: {
    draft: ['confirmed'],
    confirmed: []
  },
  invoice: {
    draft: ['unpaid'],
    unpaid: ['partial', 'paid', 'overdue'],
    partial: ['paid', 'overdue'],
    paid: [],
    overdue: ['partial', 'paid']
  }
};

function canTransition(docType, fromStatus, toStatus, userRole) {
  const allowed = STATUS_TRANSITIONS[docType]?.[fromStatus] || [];
  if (!allowed.includes(toStatus)) return false;
  if (toStatus === 'approved') {
    return [ROLES.ADMIN, ROLES.MANAGER].includes(userRole);
  }
  return true;
}

function calculateTotals(items, taxRate, discountRate) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const discountAmount = subtotal * (Number(discountRate) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (Number(taxRate) / 100);
  const total = afterDiscount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

function validateGrnAgainstLpo(lpoItems, grnItems) {
  const errors = [];
  const lpoItemMap = new Map(lpoItems.map(li => [li.id, li]));

  for (const grnItem of grnItems) {
    const lpoItem = lpoItemMap.get(grnItem.lpoLineItemId);
    if (!lpoItem) {
      errors.push(`GRN item ${grnItem.description} does not match any LPO line item`);
      continue;
    }

    if (grnItem.received > lpoItem.quantity) {
      errors.push(`Received quantity (${grnItem.received}) exceeds ordered quantity (${lpoItem.quantity}) for ${grnItem.description}`);
    }

    if (grnItem.received < lpoItem.quantity) {
      errors.push(`Shortage: ${lpoItem.quantity - grnItem.received} units for ${grnItem.description}`);
    }
  }

  return errors;
}

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function createMockUser(role) {
  return {
    id: generateId('usr'),
    name: `${role} User`,
    email: `${role}@test.com`,
    role: role,
    companyId: 'test_company'
  };
}

console.log('=== FinProx Workflow Tests ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message || 'Expected true, got false');
  }
}

function assertFalse(condition, message) {
  if (condition) {
    throw new Error(message || 'Expected false, got true');
  }
}

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) {
    throw new Error(message || 'Expected function to throw');
  }
}

console.log('--- Status Transition Tests ---\n');

test('Quotation: draft -> pending is valid', () => {
  assertTrue(canTransition('quotation', 'draft', 'pending', 'staff'));
});

test('Quotation: pending -> approved requires manager/admin', () => {
  assertTrue(canTransition('quotation', 'pending', 'approved', 'admin'));
  assertTrue(canTransition('quotation', 'pending', 'approved', 'manager'));
  assertFalse(canTransition('quotation', 'pending', 'approved', 'staff'));
});

test('Quotation: pending -> rejected is valid for manager/admin', () => {
  assertTrue(canTransition('quotation', 'pending', 'rejected', 'admin'));
  assertTrue(canTransition('quotation', 'pending', 'rejected', 'manager'));
});

test('Quotation: approved -> sent is valid', () => {
  assertTrue(canTransition('quotation', 'approved', 'sent', 'admin'));
});

test('Quotation: sent -> accepted is valid', () => {
  assertTrue(canTransition('quotation', 'sent', 'accepted', 'admin'));
});

test('Quotation: accepted -> approved is invalid (no backward flow)', () => {
  assertFalse(canTransition('quotation', 'accepted', 'approved', 'admin'));
});

test('Quotation: pending -> revision is valid', () => {
  assertTrue(canTransition('quotation', 'pending', 'revision', 'manager'));
});

test('Quotation: revision -> pending is valid', () => {
  assertTrue(canTransition('quotation', 'revision', 'pending', 'staff'));
});

test('LPO: draft -> pending is valid', () => {
  assertTrue(canTransition('lpo', 'draft', 'pending', 'staff'));
});

test('LPO: pending -> approved requires manager/admin', () => {
  assertTrue(canTransition('lpo', 'pending', 'approved', 'admin'));
  assertFalse(canTransition('lpo', 'pending', 'approved', 'staff'));
});

test('LPO: approved -> awaiting_delivery is valid', () => {
  assertTrue(canTransition('lpo', 'approved', 'awaiting_delivery', 'admin'));
});

test('LPO: awaiting_delivery -> received is valid', () => {
  assertTrue(canTransition('lpo', 'awaiting_delivery', 'received', 'manager'));
});

test('LPO: awaiting_delivery -> partially_received is valid', () => {
  assertTrue(canTransition('lpo', 'awaiting_delivery', 'partially_received', 'manager'));
});

test('LPO: partially_received -> received is valid', () => {
  assertTrue(canTransition('lpo', 'partially_received', 'received', 'manager'));
});

test('Invoice: unpaid -> partial is valid', () => {
  assertTrue(canTransition('invoice', 'unpaid', 'partial', 'admin'));
});

test('Invoice: partial -> paid is valid', () => {
  assertTrue(canTransition('invoice', 'partial', 'paid', 'admin'));
});

test('Invoice: unpaid -> overdue is valid', () => {
  assertTrue(canTransition('invoice', 'unpaid', 'overdue', 'system'));
});

test('GRN: draft -> confirmed is valid', () => {
  assertTrue(canTransition('grn', 'draft', 'confirmed', 'staff'));
});

test('GRN: confirmed -> draft is invalid', () => {
  assertFalse(canTransition('grn', 'confirmed', 'draft', 'admin'));
});

console.log('\n--- Calculation Tests ---\n');

test('Calculate totals with tax only', () => {
  const items = [
    { description: 'Item 1', quantity: 2, unitPrice: 100, amount: 200 },
    { description: 'Item 2', quantity: 1, unitPrice: 50, amount: 50 }
  ];
  const totals = calculateTotals(items, 10, 0);
  assertEqual(totals.subtotal, 250);
  assertEqual(totals.discountAmount, 0);
  assertEqual(totals.taxAmount, 25);
  assertEqual(totals.total, 275);
});

test('Calculate totals with discount only', () => {
  const items = [
    { description: 'Item 1', quantity: 2, unitPrice: 100, amount: 200 }
  ];
  const totals = calculateTotals(items, 0, 10);
  assertEqual(totals.subtotal, 200);
  assertEqual(totals.discountAmount, 20);
  assertEqual(totals.taxAmount, 0);
  assertEqual(totals.total, 180);
});

test('Calculate totals with both tax and discount', () => {
  const items = [
    { description: 'Item 1', quantity: 2, unitPrice: 100, amount: 200 }
  ];
  const totals = calculateTotals(items, 10, 20);
  assertEqual(totals.subtotal, 200);
  assertEqual(totals.discountAmount, 40);
  assertEqual(totals.taxAmount, 16);
  assertEqual(totals.total, 176);
});

test('Calculate totals with multiple items', () => {
  const items = [
    { description: 'Item 1', quantity: 3, unitPrice: 100, amount: 300 },
    { description: 'Item 2', quantity: 2, unitPrice: 75, amount: 150 },
    { description: 'Item 3', quantity: 1, unitPrice: 50, amount: 50 }
  ];
  const totals = calculateTotals(items, 5, 10);
  assertEqual(totals.subtotal, 500);
  assertEqual(totals.discountAmount, 50);
  assertEqual(totals.taxAmount, 22.5);
  assertEqual(totals.total, 472.5);
});

console.log('\n--- GRN Validation Tests ---\n');

test('GRN matches LPO quantities exactly', () => {
  const lpoItems = [
    { id: 'li1', description: 'Item A', quantity: 100 },
    { id: 'li2', description: 'Item B', quantity: 50 }
  ];
  const grnItems = [
    { lpoLineItemId: 'li1', description: 'Item A', received: 100 },
    { lpoLineItemId: 'li2', description: 'Item B', received: 50 }
  ];
  const errors = validateGrnAgainstLpo(lpoItems, grnItems);
  assertEqual(errors.length, 0);
});

test('GRN detects shortage when received < ordered', () => {
  const lpoItems = [
    { id: 'li1', description: 'Item A', quantity: 100 }
  ];
  const grnItems = [
    { lpoLineItemId: 'li1', description: 'Item A', received: 80 }
  ];
  const errors = validateGrnAgainstLpo(lpoItems, grnItems);
  assertTrue(errors.length > 0);
  assertTrue(errors[0].includes('Shortage'));
});

test('GRN detects over-receipt when received > ordered', () => {
  const lpoItems = [
    { id: 'li1', description: 'Item A', quantity: 100 }
  ];
  const grnItems = [
    { lpoLineItemId: 'li1', description: 'Item A', received: 120 }
  ];
  const errors = validateGrnAgainstLpo(lpoItems, grnItems);
  assertTrue(errors.length > 0);
  assertTrue(errors.some(e => e.includes('exceeds')));
});

test('GRN detects mismatched line items', () => {
  const lpoItems = [
    { id: 'li1', description: 'Item A', quantity: 100 }
  ];
  const grnItems = [
    { lpoLineItemId: 'li999', description: 'Wrong Item', received: 50 }
  ];
  const errors = validateGrnAgainstLpo(lpoItems, grnItems);
  assertTrue(errors.length > 0);
  assertTrue(errors.some(e => e.includes('does not match')));
});

console.log('\n--- Permission Tests ---\n');

test('Admin can do all approval actions', () => {
  const admin = createMockUser('admin');
  assertTrue(canTransition('quotation', 'pending', 'approved', admin.role));
  assertTrue(canTransition('lpo', 'pending', 'approved', admin.role));
});

test('Manager can do approval actions', () => {
  const manager = createMockUser('manager');
  assertTrue(canTransition('quotation', 'pending', 'approved', manager.role));
  assertTrue(canTransition('lpo', 'pending', 'approved', manager.role));
});

test('Staff cannot approve quotations', () => {
  const staff = createMockUser('staff');
  assertFalse(canTransition('quotation', 'pending', 'approved', staff.role));
});

test('Staff cannot approve LPOs', () => {
  const staff = createMockUser('staff');
  assertFalse(canTransition('lpo', 'pending', 'approved', staff.role));
});

test('Staff can create and edit drafts', () => {
  const staff = createMockUser('staff');
  assertTrue(canTransition('quotation', 'draft', 'pending', staff.role));
  assertTrue(canTransition('lpo', 'draft', 'pending', staff.role));
});

test('Finance role cannot approve', () => {
  const finance = createMockUser('finance');
  assertFalse(canTransition('quotation', 'pending', 'approved', finance.role));
  assertFalse(canTransition('lpo', 'pending', 'approved', finance.role));
});

console.log('\n--- Duplicate Prevention Tests ---\n');

test('Cannot resubmit accepted quotation', () => {
  assertFalse(canTransition('quotation', 'accepted', 'pending', 'staff'));
  assertFalse(canTransition('quotation', 'accepted', 'sent', 'admin'));
});

test('Cannot resubmit paid invoice', () => {
  assertFalse(canTransition('invoice', 'paid', 'unpaid', 'admin'));
});

test('Cannot resubmit received LPO', () => {
  assertFalse(canTransition('lpo', 'received', 'pending', 'manager'));
});

console.log('\n--- ID Generation Tests ---\n');

test('ID generation creates unique IDs', () => {
  const id1 = generateId('quo');
  const id2 = generateId('quo');
  assertFalse(id1 === id2);
});

test('ID generation includes prefix', () => {
  const id = generateId('quo');
  assertTrue(id.startsWith('quo_'));
});

console.log('\n--- Edge Case Tests ---\n');

test('Empty items array returns zero totals', () => {
  const totals = calculateTotals([], 10, 0);
  assertEqual(totals.subtotal, 0);
  assertEqual(totals.discountAmount, 0);
  assertEqual(totals.taxAmount, 0);
  assertEqual(totals.total, 0);
});

test('Zero tax rate returns no tax', () => {
  const items = [{ description: 'Item', quantity: 1, unitPrice: 100, amount: 100 }];
  const totals = calculateTotals(items, 0, 0);
  assertEqual(totals.taxAmount, 0);
  assertEqual(totals.total, 100);
});

test('Zero discount rate returns no discount', () => {
  const items = [{ description: 'Item', quantity: 1, unitPrice: 100, amount: 100 }];
  const totals = calculateTotals(items, 10, 0);
  assertEqual(totals.discountAmount, 0);
  assertEqual(totals.total, 110);
});

test('Invalid status transition returns false', () => {
  assertFalse(canTransition('quotation', 'pending', 'received', 'admin'));
  assertFalse(canTransition('lpo', 'draft', 'received', 'manager'));
});

test('Unknown doc type returns no valid transitions', () => {
  const allowed = STATUS_TRANSITIONS['unknown']?.['pending'] || [];
  assertEqual(allowed.length, 0);
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}

module.exports = {
  canTransition,
  calculateTotals,
  validateGrnAgainstLpo,
  generateId,
  ROLES,
  STATUS,
  STATUS_TRANSITIONS
};