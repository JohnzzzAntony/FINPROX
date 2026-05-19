require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kcjsfxkqmhqzatidizgp.supabase.co';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false }
});

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

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

function logAudit(pool, data) {
  const { docId, userId, userName, userRole, action, previousStatus, newStatus, comment, metadata, companyId } = data;
  const id = generateId('aud');
  const sql = `
    INSERT INTO audit_log (id, doc_id, doc_type, user_id, user_name, user_role, action, previous_status, new_status, comment, metadata, company_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
  `;
  pool.query(sql, [id, docId, docType, userId, userName, userRole, action, previousStatus, newStatus, comment, JSON.stringify(metadata || {}), companyId])
    .catch(err => console.error('Audit log error:', err));
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  req.user = session;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

const sessions = new Map();
const sseClients = new Map();

function createNotification(pool, data) {
  const {
    recipientId, recipientRole, senderId, senderName,
    docId, docType, docNumber, type, title, message,
    priority, companyId
  } = data;

  const id = generateId('notif');
  const sql = `
    INSERT INTO notifications (id, recipient_id, recipient_role, sender_id, sender_name,
      doc_id, doc_type, doc_number, type, title, message, priority, company_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    RETURNING *
  `;

  pool.query(sql, [
    id, recipientId, recipientRole, senderId, senderName,
    docId, docType, docNumber, type, title, message,
    priority || 'normal', companyId
  ])
  .then(result => {
    broadcastNotification(result.rows[0]);
  })
  .catch(err => console.error('Notification error:', err));
}

function broadcastNotification(notification) {
  const recipientId = notification.recipient_id;
  const recipientRole = notification.recipient_role;

  if (recipientId && sseClients.has(recipientId)) {
    const clientRes = sseClients.get(recipientId);
    clientRes.forEach(res => {
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });
  }

  if (recipientRole && sseClients.has(`role:${recipientRole}`)) {
    const roleClients = sseClients.get(`role:${recipientRole}`);
    roleClients.forEach(res => {
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });
  }

  if (sseClients.has('role:admin')) {
    const adminClients = sseClients.get('role:admin');
    adminClients.forEach(res => {
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    });
  }
}

async function initDB() {
  try {
    console.log('Connecting to Supabase PostgreSQL...');
    const client = await pool.connect();
    console.log('Connected to PostgreSQL.');
    client.release();

await pool.query(`
      CREATE TABLE IF NOT EXISTS company (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT, address TEXT, phone TEXT, email TEXT, tax_id TEXT, currency TEXT, accent TEXT, terms TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotations (
        id VARCHAR(255) PRIMARY KEY,
        client_id TEXT, client_name TEXT, subtotal DECIMAL(15,2) DEFAULT 0, tax_rate DECIMAL(5,2) DEFAULT 0,
        tax_amount DECIMAL(15,2) DEFAULT 0, discount_rate DECIMAL(5,2) DEFAULT 0, discount_amount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0, valid_until DATE, notes TEXT, attachments TEXT,
        created_by VARCHAR(255), approved_by VARCHAR(255), status TEXT DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), company_id VARCHAR(255)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotation_line_items (
        id VARCHAR(255) PRIMARY KEY,
        quotation_id VARCHAR(255) REFERENCES quotations(id) ON DELETE CASCADE,
        description TEXT, quantity DECIMAL(15,4) DEFAULT 1, unit_price DECIMAL(15,2) DEFAULT 0,
        amount DECIMAL(15,2) DEFAULT 0, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE quotation_line_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lpos (
        id VARCHAR(255) PRIMARY KEY,
        vendor_id TEXT, vendor_name TEXT, subtotal DECIMAL(15,2) DEFAULT 0, tax_rate DECIMAL(5,2) DEFAULT 0,
        tax_amount DECIMAL(15,2) DEFAULT 0, total DECIMAL(15,2) DEFAULT 0,
        delivery_date DATE, notes TEXT, approved_by VARCHAR(255),
        status TEXT DEFAULT 'draft', created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), company_id VARCHAR(255)
      )
    `);

    await pool.query(`ALTER TABLE lpos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE lpos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lpo_line_items (
        id VARCHAR(255) PRIMARY KEY,
        vendor_id TEXT, vendor_name TEXT, subtotal DECIMAL(15,2) DEFAULT 0, tax_rate DECIMAL(5,2) DEFAULT 0,
        tax_amount DECIMAL(15,2) DEFAULT 0, total DECIMAL(15,2) DEFAULT 0,
        delivery_date DATE, notes TEXT, approved_by VARCHAR(255),
        status TEXT DEFAULT 'draft', created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), company_id VARCHAR(255)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lpo_line_items (
        id VARCHAR(255) PRIMARY KEY,
        lpo_id VARCHAR(255) REFERENCES lpos(id) ON DELETE CASCADE,
        description TEXT, quantity DECIMAL(15,4) DEFAULT 1, unit_price DECIMAL(15,2) DEFAULT 0,
        amount DECIMAL(15,2) DEFAULT 0, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE lpo_line_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS grns (
        id VARCHAR(255) PRIMARY KEY,
        lpo_id TEXT, lpo_no TEXT, vendor_name TEXT, discrepancy TEXT,
        status TEXT DEFAULT 'draft', created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), company_id VARCHAR(255)
      )
    `);

    await pool.query(`ALTER TABLE grns ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE grns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS grn_line_items (
        id VARCHAR(255) PRIMARY KEY,
        grn_id VARCHAR(255) REFERENCES grns(id) ON DELETE CASCADE,
        lpo_line_item_id TEXT,
        description TEXT, ordered_quantity DECIMAL(15,4) DEFAULT 0,
        received_quantity DECIMAL(15,4) DEFAULT 0, condition TEXT DEFAULT 'Good',
        shortage_quantity DECIMAL(15,4) DEFAULT 0, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE grn_line_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id VARCHAR(255) PRIMARY KEY,
        quotation_id TEXT, client_id TEXT, client_name TEXT,
        subtotal DECIMAL(15,2) DEFAULT 0, tax_rate DECIMAL(5,2) DEFAULT 0,
        tax_amount DECIMAL(15,2) DEFAULT 0, discount_amount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0, paid_amount DECIMAL(15,2) DEFAULT 0,
        due_date DATE, status TEXT DEFAULT 'draft', created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), company_id VARCHAR(255)
      )
    `);

    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_line_items (
        id VARCHAR(255) PRIMARY KEY,
        invoice_id VARCHAR(255) REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT, quantity DECIMAL(15,4) DEFAULT 1, unit_price DECIMAL(15,2) DEFAULT 0,
        amount DECIMAL(15,2) DEFAULT 0, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(255) PRIMARY KEY,
        invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        amount DECIMAL(15,2) DEFAULT 0, date DATE, method TEXT, reference TEXT,
        recorded_by VARCHAR(255), company_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id VARCHAR(255) PRIMARY KEY,
        doc_id TEXT, doc_type TEXT, user_id TEXT, user_name TEXT, user_role TEXT,
        action TEXT, previous_status TEXT, new_status TEXT, comment TEXT,
        metadata JSONB DEFAULT '{}', company_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_log (
        id VARCHAR(255) PRIMARY KEY,
        doc_id TEXT, doc_type TEXT, recipient_email TEXT, subject TEXT, status TEXT,
        error_message TEXT, sent_at TIMESTAMP DEFAULT NOW(), company_id VARCHAR(255)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(255) PRIMARY KEY,
        recipient_id TEXT, recipient_role TEXT,
        sender_id TEXT, sender_name TEXT,
        doc_id TEXT, doc_type TEXT, doc_number TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        priority TEXT DEFAULT 'normal',
        is_read BOOLEAN DEFAULT FALSE,
        company_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(recipient_role)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read = FALSE`);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_quotations_company ON quotations(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lpos_company ON lpos(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lpos_status ON lpos(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_grns_company ON grns(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_doc ON audit_log(doc_id, doc_type)`);

    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", ['johns@admin.com']);
    if (userRes.rows.length === 0) {
      await pool.query("INSERT INTO users (id, name, email, password, role, company_id) VALUES ($1,$2,$3,$4,$5,$6)",
        ['admin_johns', 'John Admin', 'johns@admin.com', '123ewqasd', 'admin', 'primary']);

      await pool.query("INSERT INTO users (id, name, email, password, role, company_id) VALUES ($1,$2,$3,$4,$5,$6)",
        ['manager_demo', 'Sarah Manager', 'manager@finprox.com', 'manager123', 'manager', 'primary']);

      await pool.query("INSERT INTO users (id, name, email, password, role, company_id) VALUES ($1,$2,$3,$4,$5,$6)",
        ['staff_demo', 'Mike Staff', 'staff@finprox.com', 'staff123', 'staff', 'primary']);
    }

    const compRes = await pool.query("SELECT * FROM company WHERE id = $1", ['primary']);
    if (compRes.rows.length === 0) {
      await pool.query("INSERT INTO company (id, name, address, phone, email, tax_id, currency, accent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        ['primary', 'FinProx Enterprise', 'Main HQ', '+971 000 000', 'johns@admin.com', 'TRN-001', 'AED', '#d97706']);
    }

    console.log('Database schema initialized successfully');
  } catch (err) {
    console.error('PostgreSQL Init Error:', err);
  }
}

initDB();

const toSnake = (str) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const convertKeys = (obj) => {
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toSnake(k), Array.isArray(v) ? v.map(convertKeys) : convertKeys(v)])
    );
  }
  return obj;
};
const toCamel = (str) => str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const convertFromSnake = (obj) => {
  if (Array.isArray(obj)) return obj.map(convertFromSnake);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toCamel(k), Array.isArray(v) ? v.map(convertFromSnake) : convertFromSnake(v)])
    );
  }
  return obj;
};

function calculateTotals(items, taxRate, discountRate) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const discountAmount = subtotal * (Number(discountRate) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (Number(taxRate) / 100);
  const total = afterDiscount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

function logWorkflowAudit(pool, data) {
  const { docId, docType, userId, userName, userRole, action, prevStatus, newStatus, comment, metadata, companyId } = data;
  const id = generateId('aud');
  const sql = `
    INSERT INTO audit_log (id, doc_id, doc_type, user_id, user_name, user_role, action, previous_status, new_status, comment, metadata, company_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
  `;
  pool.query(sql, [id, docId, docType, userId, userName, userRole, action, prevStatus, newStatus, comment, JSON.stringify(metadata || {}), companyId])
    .catch(err => console.error('Audit log error:', err));
}

function logEmail(pool, data) {
  const { docId, docType, recipient, subject, status, error, companyId } = data;
  const id = generateId('eml');
  pool.query(
    `INSERT INTO email_log (id, doc_id, doc_type, recipient_email, subject, status, error_message, company_id, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [id, docId, docType, recipient, subject, status, error, companyId]
  ).catch(err => console.error('Email log error:', err));
}

const tables = ['vendors', 'clients', 'quotations', 'lpos', 'grns', 'invoices', 'payments', 'users'];

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.company_id
    });

    res.json({ token, user: convertFromSnake(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions.has(token)) {
    sessions.delete(token);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  res.json({ user: session });
});

app.get('/api/notifications/stream', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const clientKey = session.role === 'staff' ? session.id : `role:${session.role}`;
  if (!sseClients.has(clientKey)) {
    sseClients.set(clientKey, new Set());
  }
  sseClients.get(clientKey).add(res);

  req.on('close', () => {
    if (sseClients.has(clientKey)) {
      sseClients.get(clientKey).delete(res);
      if (sseClients.get(clientKey).size === 0) {
        sseClients.delete(clientKey);
      }
    }
  });
});

app.get('/api/notifications', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  const { unreadOnly, limit } = req.query;

  try {
    let sql = `
      SELECT * FROM notifications
      WHERE (recipient_id = $1 OR recipient_role IN ($2, 'admin'))
        AND company_id = $3
    `;
    const params = [session.id, session.role, session.companyId];

    if (unreadOnly === 'true') {
      sql += ` AND is_read = FALSE`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $4`;
    params.push(limit || 50);

    const { rows } = await pool.query(sql, params);
    res.json(rows.map(convertFromSnake));
  } catch (err) {
    console.error('Notifications fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND (recipient_id = $2 OR recipient_role = $3)`,
      [id, session.id, session.role]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Notification mark read error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/read-all', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE (recipient_id = $1 OR recipient_role = $2) AND company_id = $3`,
      [session.id, session.role, session.companyId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Notification mark all read error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/approvals/pending', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  if (!['admin', 'manager'].includes(session.role)) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  try {
    const [quotations, lpos] = await Promise.all([
      pool.query(`
        SELECT q.*, u.name as creator_name, c.name as client_name
        FROM quotations q
        LEFT JOIN users u ON q.created_by = u.id
        LEFT JOIN clients c ON q.client_id = c.id
        WHERE q.status = 'pending' AND q.company_id = $1
        ORDER BY q.created_at DESC
      `, [session.companyId]),
      pool.query(`
        SELECT l.*, u.name as creator_name, v.name as vendor_name
        FROM lpos l
        LEFT JOIN users u ON l.created_by = u.id
        LEFT JOIN vendors v ON l.vendor_id = v.id
        WHERE l.status = 'pending' AND l.company_id = $1
        ORDER BY l.created_at DESC
      `, [session.companyId])
    ]);

    res.json({
      quotations: quotations.rows.map(convertFromSnake),
      lpos: lpos.rows.map(convertFromSnake)
    });
  } catch (err) {
    console.error('Approvals fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals/quotation/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  if (!['admin', 'manager'].includes(session.role)) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const { id } = req.params;
  const { action, comment } = req.body;

  if (!['approve', 'reject', 'request_revision'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be approve, reject, or request_revision' });
  }

  if (action === 'reject' && !comment) {
    return res.status(400).json({ error: 'Rejection comment is required' });
  }

  if (action === 'request_revision' && !comment) {
    return res.status(400).json({ error: 'Revision request comment is required' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM quotations WHERE id = $1 AND company_id = $2', [id, session.companyId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });

    const quotation = rows[0];

    if (quotation.status !== 'pending') {
      return res.status(400).json({ error: 'Quotation is not pending approval' });
    }

    let newStatus;
    let actionVerb;

    switch (action) {
      case 'approve':
        newStatus = 'approved';
        actionVerb = 'Approved';
        break;
      case 'reject':
        newStatus = 'rejected';
        actionVerb = 'Rejected';
        break;
      case 'request_revision':
        newStatus = 'revision';
        actionVerb = 'Revision Requested';
        break;
    }

    await pool.query(
      `UPDATE quotations SET status = $1, approved_by = $2, updated_at = NOW() WHERE id = $3`,
      [newStatus, session.id, id]
    );

    logWorkflowAudit(pool, {
      docId: id, docType: 'quotation', userId: session.id, userName: session.name, userRole: session.role,
      action: actionVerb, prevStatus: 'pending', newStatus,
      comment, metadata: { action }, companyId: session.companyId
    });

    createNotification(pool, {
      recipientId: quotation.created_by,
      senderId: session.id,
      senderName: session.name,
      docId: id,
      docType: 'quotation',
      docNumber: quotation.id,
      type: 'approval_response',
      title: `Quotation ${actionVerb}`,
      message: `Your quotation ${quotation.id} has been ${actionVerb.toLowerCase()}${comment ? ': ' + comment : ''}`,
      priority: action === 'reject' ? 'high' : 'normal',
      companyId: session.companyId
    });

    res.json({ success: true, newStatus });
  } catch (err) {
    console.error('Quotation approval error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals/lpo/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  if (!['admin', 'manager'].includes(session.role)) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const { id } = req.params;
  const { action, comment } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be approve or reject' });
  }

  if (action === 'reject' && !comment) {
    return res.status(400).json({ error: 'Rejection comment is required' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM lpos WHERE id = $1 AND company_id = $2', [id, session.companyId]);
    if (rows.length === 0) return res.status(404).json({ error: 'LPO not found' });

    const lpo = rows[0];

    if (lpo.status !== 'pending') {
      return res.status(400).json({ error: 'LPO is not pending approval' });
    }

    let newStatus;
    let actionVerb;

    switch (action) {
      case 'approve':
        newStatus = 'approved';
        actionVerb = 'Approved';
        break;
      case 'reject':
        newStatus = 'rejected';
        actionVerb = 'Rejected';
        break;
    }

    await pool.query(
      `UPDATE lpos SET status = $1, approved_by = $2, updated_at = NOW() WHERE id = $3`,
      [newStatus, session.id, id]
    );

    logWorkflowAudit(pool, {
      docId: id, docType: 'lpo', userId: session.id, userName: session.name, userRole: session.role,
      action: actionVerb, prevStatus: 'pending', newStatus,
      comment, metadata: { action }, companyId: session.companyId
    });

    createNotification(pool, {
      recipientId: lpo.created_by,
      senderId: session.id,
      senderName: session.name,
      docId: id,
      docType: 'lpo',
      docNumber: lpo.id,
      type: 'approval_response',
      title: `LPO ${actionVerb}`,
      message: `Your LPO ${lpo.id} has been ${actionVerb.toLowerCase()}${comment ? ': ' + comment : ''}`,
      priority: action === 'reject' ? 'high' : 'normal',
      companyId: session.companyId
    });

    res.json({ success: true, newStatus });
  } catch (err) {
    console.error('LPO approval error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required' });
  }

  if (!['admin', 'manager', 'staff', 'finance'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin, manager, staff, or finance' });
  }

  try {
    const checkRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (checkRes.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const userId = generateId('usr');
    await pool.query(
      `INSERT INTO users (id, name, email, password, role, company_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, name, email, password, role, session.companyId]
    );

    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);

    logWorkflowAudit(pool, {
      docId: userId, docType: 'user', userId: session.id, userName: session.name, userRole: session.role,
      action: 'User Created', prevStatus: null, newStatus: 'active',
      comment: `Created user ${email} with role ${role}`, metadata: { newUserRole: role }, companyId: session.companyId
    });

    res.json({ success: true, user: convertFromSnake(userRes.rows[0]) });
  } catch (err) {
    console.error('User creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { id } = req.params;
  const { name, email, password, role } = req.body;

  try {
    const existingUser = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const values = [];
    let paramCount = 0;

    if (name) {
      paramCount++;
      updates.push(`name = $${paramCount}`);
      values.push(name);
    }
    if (email) {
      paramCount++;
      updates.push(`email = $${paramCount}`);
      values.push(email);
    }
    if (password) {
      paramCount++;
      updates.push(`password = $${paramCount}`);
      values.push(password);
    }
    if (role) {
      if (!['admin', 'manager', 'staff', 'finance'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      paramCount++;
      updates.push(`role = $${paramCount}`);
      values.push(role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    paramCount++;
    values.push(id);

    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [id]);

    logWorkflowAudit(pool, {
      docId: id, docType: 'user', userId: session.id, userName: session.name, userRole: session.role,
      action: 'User Updated', prevStatus: null, newStatus: 'active',
      comment: `Updated user fields: ${updates.filter(u => !u.includes('updated_at')).join(', ')}`, metadata: { role }, companyId: session.companyId
    });

    res.json({ success: true, user: convertFromSnake(userRes.rows[0]) });
  } catch (err) {
    console.error('User update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { id } = req.params;

  if (id === session.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const existingUser = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    logWorkflowAudit(pool, {
      docId: id, docType: 'user', userId: session.id, userName: session.name, userRole: session.role,
      action: 'User Deleted', prevStatus: 'active', newStatus: 'deleted',
      comment: `Deleted user ${existingUser.rows[0].email}`, companyId: session.companyId
    });

    res.json({ success: true });
  } catch (err) {
    console.error('User deletion error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/company/:id', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM company WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.json(null);
    res.json(convertFromSnake(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const { cid } = req.query;
    if (!cid) return res.status(400).json({ error: 'Company ID required' });

    const [openLpos, pendingApprovals, overdueInvoices, recentGrns, pendingQuotes] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM lpos WHERE company_id = $1 AND status IN ('approved', 'sent', 'awaiting_delivery', 'partially_received')`, [cid]),
      pool.query(`SELECT COUNT(*) as count FROM quotations WHERE company_id = $1 AND status = 'pending'`, [cid]),
      pool.query(`SELECT COUNT(*) as count FROM invoices WHERE company_id = $1 AND status = 'overdue'`, [cid]),
      pool.query(`SELECT COUNT(*) as count FROM grns WHERE company_id = $1 AND created_at > NOW() - INTERVAL '7 days'`, [cid]),
      pool.query(`SELECT COUNT(*) as count FROM quotations WHERE company_id = $1 AND status = 'pending'`, [cid])
    ]);

    const [invoiceStats, lpoStats, quoteStats] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(total), 0) as total_outstanding,
          COALESCE(SUM(CASE WHEN status = 'overdue' THEN total - paid_amount ELSE 0 END), 0) as total_overdue,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN paid_amount ELSE 0 END), 0) as total_collected,
          COUNT(*) as count
        FROM invoices WHERE company_id = $1
      `, [cid]),
      pool.query(`
        SELECT COUNT(*) as count, status FROM lpos WHERE company_id = $1 GROUP BY status
      `, [cid]),
      pool.query(`
        SELECT COUNT(*) as count, status FROM quotations WHERE company_id = $1 GROUP BY status
      `, [cid])
    ]);

    res.json({
      openLpos: parseInt(openLpos.rows[0]?.count || 0),
      pendingApprovals: parseInt(pendingApprovals.rows[0]?.count || 0),
      overdueInvoices: parseInt(overdueInvoices.rows[0]?.count || 0),
      recentGrns: parseInt(recentGrns.rows[0]?.count || 0),
      pendingQuotes: parseInt(pendingQuotes.rows[0]?.count || 0),
      invoiceStats: {
        totalOutstanding: parseFloat(invoiceStats.rows[0]?.total_outstanding || 0),
        totalOverdue: parseFloat(invoiceStats.rows[0]?.total_overdue || 0),
        totalCollected: parseFloat(invoiceStats.rows[0]?.total_collected || 0),
        count: parseInt(invoiceStats.rows[0]?.count || 0)
      },
      lpoStats: lpoStats.rows,
      quoteStats: quoteStats.rows
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit/:docType/:docId', async (req, res) => {
  try {
    const { docType, docId } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE doc_type = $1 AND doc_id = $2 ORDER BY created_at DESC`,
      [docType, docId]
    );
    res.json(rows.map(convertFromSnake));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/:table/:id', async (req, res) => {
  const { table, id } = req.params;
  if (!tables.includes(table)) return res.status(400).send('Invalid table');
  try {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/:table', async (req, res) => {
  const { table } = req.params;
  const { cid, status, created_by } = req.query;
  if (!tables.includes(table)) return res.status(400).send('Invalid table');

  try {
    let query = `SELECT * FROM ${table}`;
    const params = [];
    const conditions = [];

    if (cid) {
      conditions.push(`company_id = $${params.length + 1}`);
      params.push(cid);
    }
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    if (created_by) {
      conditions.push(`created_by = $${params.length + 1}`);
      params.push(created_by);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const { rows } = await pool.query(query, params);
    const parsed = rows.map(r => convertFromSnake(r));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflow/:action', async (req, res) => {
  const { action } = req.params;
  const { docType, docId, userId, userName, userRole, comment, metadata, companyId } = req.body;

  try {
    let result;

    switch (action) {
      case 'approve_quotation': {
        const q = await pool.query('SELECT * FROM quotations WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
        const quote = q.rows[0];

        if (!canTransition('quotation', quote.status, 'approved', userRole)) {
          return res.status(400).json({ error: 'Invalid status transition' });
        }

        await pool.query(
          `UPDATE quotations SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2`,
          [userId, docId]
        );

        logWorkflowAudit(pool, {
          docId, docType: 'quotation', userId, userName, userRole,
          action: 'Approved', prevStatus: quote.status, newStatus: 'approved',
          comment, metadata, companyId
        });

        result = { success: true, newStatus: 'approved' };
        break;
      }

      case 'reject_quotation': {
        if (!comment) return res.status(400).json({ error: 'Rejection reason required' });
        const q = await pool.query('SELECT * FROM quotations WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
        const quote = q.rows[0];

        if (!canTransition('quotation', quote.status, 'rejected', userRole)) {
          return res.status(400).json({ error: 'Invalid status transition' });
        }

        await pool.query(
          `UPDATE quotations SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
          [docId]
        );

        logWorkflowAudit(pool, {
          docId, docType: 'quotation', userId, userName, userRole,
          action: 'Rejected', prevStatus: quote.status, newStatus: 'rejected',
          comment, metadata, companyId
        });

        result = { success: true, newStatus: 'rejected' };
        break;
      }

      case 'request_revision': {
        if (!comment) return res.status(400).json({ error: 'Revision details required' });
        const q = await pool.query('SELECT * FROM quotations WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
        const quote = q.rows[0];

        if (!canTransition('quotation', quote.status, 'revision', userRole)) {
          return res.status(400).json({ error: 'Invalid status transition' });
        }

        await pool.query(`UPDATE quotations SET status = 'revision', updated_at = NOW() WHERE id = $1`, [docId]);

        logWorkflowAudit(pool, {
          docId, docType: 'quotation', userId, userName, userRole,
          action: 'Revision Requested', prevStatus: quote.status, newStatus: 'revision',
          comment, metadata, companyId
        });

        result = { success: true, newStatus: 'revision' };
        break;
      }

      case 'send_quotation': {
        const q = await pool.query('SELECT * FROM quotations WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
        const quote = q.rows[0];

        if (quote.status !== 'approved') {
          return res.status(400).json({ error: 'Quotation must be approved before sending' });
        }

        await pool.query(`UPDATE quotations SET status = 'sent', updated_at = NOW() WHERE id = $1`, [docId]);

        logWorkflowAudit(pool, {
          docId, docType: 'quotation', userId, userName, userRole,
          action: 'Sent to Client', prevStatus: quote.status, newStatus: 'sent',
          comment: 'Quotation sent via email', metadata, companyId
        });

        result = { success: true, newStatus: 'sent' };
        break;
      }

      case 'accept_quotation': {
        const q = await pool.query('SELECT * FROM quotations WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (q.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
        const quote = q.rows[0];

        if (quote.status !== 'sent') {
          return res.status(400).json({ error: 'Quotation must be sent before acceptance' });
        }

        await pool.query(`UPDATE quotations SET status = 'accepted', updated_at = NOW() WHERE id = $1`, [docId]);

        const lineItems = await pool.query('SELECT * FROM quotation_line_items WHERE quotation_id = $1', [docId]);
        const invoiceId = generateId('inv');
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);

        await pool.query(`
          INSERT INTO invoices (id, quotation_id, client_id, client_name, subtotal, tax_rate, tax_amount, discount_amount, total, due_date, status, created_by, company_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unpaid', $11, $12)
        `, [invoiceId, docId, quote.client_id, quote.client_name, quote.subtotal, quote.tax_rate, quote.tax_amount, quote.discount_amount, quote.total, dueDate.toISOString().split('T')[0], userId, companyId]);

        for (const item of lineItems.rows) {
          await pool.query(`
            INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, amount)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [generateId('ili'), invoiceId, item.description, item.quantity, item.unit_price, item.amount]);
        }

        logWorkflowAudit(pool, {
          docId, docType: 'quotation', userId, userName, userRole,
          action: 'Client Accepted', prevStatus: quote.status, newStatus: 'accepted',
          comment: `Invoice ${invoiceId} auto-generated`, metadata, companyId
        });

        logWorkflowAudit(pool, {
          docId: invoiceId, docType: 'invoice', userId, userName, userRole,
          action: 'Auto-created from Quotation', prevStatus: null, newStatus: 'unpaid',
          comment: `Linked to ${docId}`, metadata, companyId
        });

        result = { success: true, newStatus: 'accepted', invoiceId };
        break;
      }

      case 'approve_lpo': {
        const l = await pool.query('SELECT * FROM lpos WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (l.rows.length === 0) return res.status(404).json({ error: 'LPO not found' });
        const lpo = l.rows[0];

        if (!canTransition('lpo', lpo.status, 'approved', userRole)) {
          return res.status(400).json({ error: 'Invalid status transition' });
        }

        await pool.query(
          `UPDATE lpos SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2`,
          [userId, docId]
        );

        logWorkflowAudit(pool, {
          docId, docType: 'lpo', userId, userName, userRole,
          action: 'Approved', prevStatus: lpo.status, newStatus: 'approved',
          comment, metadata, companyId
        });

        result = { success: true, newStatus: 'approved' };
        break;
      }

      case 'reject_lpo': {
        if (!comment) return res.status(400).json({ error: 'Rejection reason required' });
        const l = await pool.query('SELECT * FROM lpos WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (l.rows.length === 0) return res.status(404).json({ error: 'LPO not found' });
        const lpo = l.rows[0];

        if (!canTransition('lpo', lpo.status, 'rejected', userRole)) {
          return res.status(400).json({ error: 'Invalid status transition' });
        }

        await pool.query(`UPDATE lpos SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [docId]);

        logWorkflowAudit(pool, {
          docId, docType: 'lpo', userId, userName, userRole,
          action: 'Rejected', prevStatus: lpo.status, newStatus: 'rejected',
          comment, metadata, companyId
        });

        result = { success: true, newStatus: 'rejected' };
        break;
      }

      case 'send_lpo': {
        const l = await pool.query('SELECT * FROM lpos WHERE id = $1 AND company_id = $2', [docId, companyId]);
        if (l.rows.length === 0) return res.status(404).json({ error: 'LPO not found' });
        const lpo = l.rows[0];

        if (lpo.status !== 'approved') {
          return res.status(400).json({ error: 'LPO must be approved before sending' });
        }

        await pool.query(`UPDATE lpos SET status = 'awaiting_delivery', updated_at = NOW() WHERE id = $1`, [docId]);

        logWorkflowAudit(pool, {
          docId, docType: 'lpo', userId, userName, userRole,
          action: 'Sent to Vendor', prevStatus: lpo.status, newStatus: 'awaiting_delivery',
          comment: 'LPO sent via email', metadata, companyId
        });

        result = { success: true, newStatus: 'awaiting_delivery' };
        break;
      }

      case 'confirm_grn': {
        const { items, discrepancy, lpoId } = metadata || {};

        if (!items || !Array.isArray(items)) {
          return res.status(400).json({ error: 'GRN items required' });
        }

        const lpo = await pool.query('SELECT * FROM lpos WHERE id = $1 AND company_id = $2', [lpoId, companyId]);
        if (lpo.rows.length === 0) return res.status(404).json({ error: 'LPO not found' });

        const grnId = generateId('grn');
        const lpoData = lpo.rows[0];

        await pool.query(`
          INSERT INTO grns (id, lpo_id, lpo_no, vendor_name, discrepancy, status, created_by, company_id)
          VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7)
        `, [grnId, lpoId, lpoData.id, lpoData.vendor_name, discrepancy || '', userId, companyId]);

        for (const item of items) {
          await pool.query(`
            INSERT INTO grn_line_items (id, grn_id, lpo_line_item_id, description, ordered_quantity, received_quantity, condition, shortage_quantity)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [generateId('gli'), grnId, item.lpoLineItemId, item.description, item.ordered, item.received, item.condition || 'Good', Math.max(0, item.ordered - item.received)]);
        }

        const lpoItems = await pool.query('SELECT * FROM lpo_line_items WHERE lpo_id = $1', [lpoId]);
        const grnItems = items;

        let allReceived = true;
        let partiallyReceived = false;

        for (const lpoItem of lpoItems.rows) {
          const grnItem = grnItems.find(gi => gi.lpoLineItemId === lpoItem.id);
          if (!grnItem || grnItem.received < lpoItem.quantity || grnItem.condition !== 'Good') {
            allReceived = false;
            if (grnItem && grnItem.received > 0) {
              partiallyReceived = true;
            }
          }
        }

        const newLpoStatus = allReceived ? 'received' : (partiallyReceived ? 'partially_received' : 'awaiting_delivery');

        await pool.query(`UPDATE lpos SET status = $1, updated_at = NOW() WHERE id = $2`, [newLpoStatus, lpoId]);

        logWorkflowAudit(pool, {
          docId: grnId, docType: 'grn', userId, userName, userRole,
          action: 'GRN Confirmed', prevStatus: null, newStatus: 'confirmed',
          comment: `Linked to LPO ${lpoId}. Status: ${newLpoStatus}`, metadata: { lpoId, discrepancy }, companyId
        });

        logWorkflowAudit(pool, {
          docId: lpoId, docType: 'lpo', userId, userName, userRole,
          action: 'LPO Updated from GRN', prevStatus: lpoData.status, newStatus: newLpoStatus,
          comment: `GRN ${grnId} processed`, metadata: { grnId }, companyId
        });

        result = { success: true, grnId, lpoStatus: newLpoStatus };
        break;
      }

      case 'record_payment': {
        const { invoiceId, amount, date, method, reference } = metadata || {};

        if (!invoiceId || !amount) return res.status(400).json({ error: 'Invoice ID and amount required' });

        const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2', [invoiceId, companyId]);
        if (invoice.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

        const inv = invoice.rows[0];
        const newPaidAmount = parseFloat(inv.paid_amount) + parseFloat(amount);

        let newStatus = 'partial';
        if (newPaidAmount >= parseFloat(inv.total)) {
          newStatus = 'paid';
        }

        await pool.query(
          `UPDATE invoices SET paid_amount = $1, status = $2, updated_at = NOW() WHERE id = $3`,
          [newPaidAmount, newStatus, invoiceId]
        );

        await pool.query(`
          INSERT INTO payments (id, invoice_id, amount, date, method, reference, recorded_by, company_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [generateId('pay'), invoiceId, amount, date || new Date().toISOString().split('T')[0], method, reference, userId, companyId]);

        logWorkflowAudit(pool, {
          docId: invoiceId, docType: 'invoice', userId, userName, userRole,
          action: 'Payment Recorded', prevStatus: inv.status, newStatus: newStatus,
          comment: `Amount: ${amount}. Method: ${method}. Reference: ${reference}`, metadata, companyId
        });

        result = { success: true, newStatus, paidAmount: newPaidAmount };
        break;
      }

      default:
        return res.status(400).json({ error: 'Unknown workflow action' });
    }

    res.json(result);
  } catch (err) {
    console.error('Workflow error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/:type', async (req, res) => {
  const { type } = req.params;
  const { clientId, clientName, items, validUntil, taxRate, discountRate, notes, attachments, vendorId, vendorName, deliveryDate, createdBy, companyId } = req.body;

  try {
    if (!['quotation', 'lpo'].includes(type)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Line items required' });
    }

    const processedItems = items.map((item, index) => ({
      description: item.description || item.desc,
      quantity: parseFloat(item.quantity || item.qty || 1),
      unitPrice: parseFloat(item.unitPrice || item.rate || 0),
      amount: parseFloat(item.amount || (item.quantity * item.rate) || 0),
      sortOrder: index
    }));

    const totals = calculateTotals(processedItems, taxRate || 0, discountRate || 0);

    const docId = generateId(type === 'quotation' ? 'quo' : 'lpo');

    if (type === 'quotation') {
      await pool.query(`
        INSERT INTO quotations (id, client_id, client_name, subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total, valid_until, notes, attachments, status, created_by, company_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14)
      `, [docId, clientId, clientName, totals.subtotal, taxRate || 0, totals.taxAmount, discountRate || 0, totals.discountAmount, totals.total, validUntil, notes, JSON.stringify(attachments || []), createdBy, companyId]);

      for (const item of processedItems) {
        await pool.query(`
          INSERT INTO quotation_line_items (id, quotation_id, description, quantity, unit_price, amount, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [generateId('qli'), docId, item.description, item.quantity, item.unitPrice, item.amount, item.sortOrder]);
      }
    } else {
      await pool.query(`
        INSERT INTO lpos (id, vendor_id, vendor_name, subtotal, tax_rate, tax_amount, total, delivery_date, notes, status, created_by, company_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11)
      `, [docId, vendorId, vendorName, totals.subtotal, taxRate || 0, totals.taxAmount, totals.total, deliveryDate, notes, createdBy, companyId]);

      for (const item of processedItems) {
        await pool.query(`
          INSERT INTO lpo_line_items (id, lpo_id, description, quantity, unit_price, amount, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [generateId('lli'), docId, item.description, item.quantity, item.unitPrice, item.amount, item.sortOrder]);
      }
    }

    logWorkflowAudit(pool, {
      docId, docType: type, userId: createdBy, userName: createdBy, userRole: 'staff',
      action: 'Created', prevStatus: null, newStatus: 'pending',
      comment: `${type === 'quotation' ? 'Quotation' : 'LPO'} created with ${items.length} line items`,
      metadata: { itemCount: items.length, total: totals.total }, companyId
    });

    createNotification(pool, {
      recipientRole: 'manager',
      senderId: createdBy,
      senderName: createdBy,
      docId,
      docType: type,
      docNumber: docId,
      type: 'approval_required',
      title: `New ${type === 'quotation' ? 'Quotation' : 'LPO'} Pending Approval`,
      message: `${createdBy} submitted ${type} ${docId} for ${totals.total} awaiting your approval`,
      priority: 'high',
      companyId
    });

    createNotification(pool, {
      recipientRole: 'admin',
      senderId: createdBy,
      senderName: createdBy,
      docId,
      docType: type,
      docNumber: docId,
      type: 'approval_required',
      title: `New ${type === 'quotation' ? 'Quotation' : 'LPO'} Pending Approval`,
      message: `${createdBy} submitted ${type} ${docId} for ${totals.total} awaiting approval`,
      priority: 'high',
      companyId
    });

    res.json({ success: true, id: docId });
  } catch (err) {
    console.error('Document creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/documents/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    let doc, lineItems, tableName, lineTable;

    if (type === 'quotation') {
      tableName = 'quotations';
      lineTable = 'quotation_line_items';
    } else if (type === 'lpo') {
      tableName = 'lpos';
      lineTable = 'lpo_line_items';
    } else if (type === 'grn') {
      tableName = 'grns';
      lineTable = 'grn_line_items';
    } else if (type === 'invoice') {
      tableName = 'invoices';
      lineTable = 'invoice_line_items';
    } else {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const docResult = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
    if (docResult.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    const itemsResult = await pool.query(`SELECT * FROM ${lineTable} WHERE ${type === 'quotation' ? 'quotation_id' : type === 'lpo' ? 'lpo_id' : type === 'grn' ? 'grn_id' : 'invoice_id'} = $1 ORDER BY sort_order`, [id]);

    res.json({
      ...convertFromSnake(docResult.rows[0]),
      lineItems: itemsResult.rows.map(convertFromSnake)
    });
  } catch (err) {
    console.error('Document fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/overdue/check', async (req, res) => {
  try {
    const { companyId } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const result = await pool.query(`
      UPDATE invoices
      SET status = 'overdue', updated_at = NOW()
      WHERE company_id = $1
        AND status IN ('unpaid', 'partial')
        AND due_date < $2
        AND status != 'overdue'
      RETURNING id
    `, [companyId, today]);

    const updatedInvoices = result.rows;

    for (const inv of updatedInvoices) {
      logWorkflowAudit(pool, {
        docId: inv.id, docType: 'invoice', userId: 'system', userName: 'System',
        userRole: 'admin', action: 'Marked Overdue', prevStatus: 'unpaid/partial',
        newStatus: 'overdue', comment: 'Automatic overdue check', companyId
      });
    }

    res.json({ success: true, updatedCount: updatedInvoices.length });
  } catch (err) {
    console.error('Overdue check error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/send', async (req, res) => {
  const { docId, docType, recipientEmail, subject, companyId } = req.body;
  try {
    logEmail(pool, {
      docId, docType, recipient: recipientEmail, subject,
      status: 'queued', error: null, companyId
    });

    res.json({ success: true, message: 'Email queued for sending' });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/email/logs', async (req, res) => {
  const { docId, cid } = req.query;
  try {
    let query = 'SELECT * FROM email_log';
    const params = [];
    const conditions = [];

    if (docId) {
      conditions.push(`doc_id = $${params.length + 1}`);
      params.push(docId);
    }
    if (cid) {
      conditions.push(`company_id = $${params.length + 1}`);
      params.push(cid);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY sent_at DESC LIMIT 100';

    const { rows } = await pool.query(query, params);
    res.json(rows.map(convertFromSnake));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

