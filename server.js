require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increased for attachments
app.use(express.static(__dirname)); 

// MySQL Connection Pool
let pool;

async function initDB() {
  try {
    // Initial connection without database to create it if it doesn't exist
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
    });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'finprox'}\``);
    await connection.end();

    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'finprox',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    console.log('Connecting to MySQL...');
    // Test connection
    const conn = await pool.getConnection();
    console.log('Connected to MySQL database.');
    conn.release();

    // Debug: list users
    const [users] = await pool.query("SELECT id, name, email, role FROM users");
    console.log('Users in database:', users);

    // Create Tables
    await pool.query(`CREATE TABLE IF NOT EXISTS company (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT, address TEXT, phone TEXT, email TEXT, tax_id TEXT, currency TEXT, accent TEXT, terms TEXT
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT, email VARCHAR(255) UNIQUE, password TEXT, role TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS vendors (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT, email TEXT, phone TEXT, address TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS clients (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT, email TEXT, phone TEXT, address TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS quotations (
      id VARCHAR(255) PRIMARY KEY,
      client_id TEXT, client_name TEXT, items LONGTEXT, subtotal DOUBLE, tax DOUBLE, discount DOUBLE, total DOUBLE, 
      valid_until TEXT, notes TEXT, created_by TEXT, status TEXT, created_at TEXT, company_id VARCHAR(255), attachments LONGTEXT
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS lpos (
      id VARCHAR(255) PRIMARY KEY,
      vendor_id TEXT, vendor_name TEXT, items LONGTEXT, subtotal DOUBLE, tax DOUBLE, total DOUBLE, 
      delivery_date TEXT, notes TEXT, created_by TEXT, status TEXT, created_at TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS grns (
      id VARCHAR(255) PRIMARY KEY,
      lpo_id TEXT, lpo_no TEXT, vendor_name TEXT, items LONGTEXT, discrepancy TEXT, 
      status TEXT, created_at TEXT, created_by TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS invoices (
      id VARCHAR(255) PRIMARY KEY,
      quotation_id TEXT, client_id TEXT, client_name TEXT, items LONGTEXT, 
      subtotal DOUBLE, tax DOUBLE, total DOUBLE, status TEXT, paid_amount DOUBLE, 
      due_date TEXT, created_at TEXT, created_by TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(255) PRIMARY KEY,
      invoice_id TEXT, amount DOUBLE, date TEXT, method TEXT, reference TEXT, company_id VARCHAR(255)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS audit (
      id VARCHAR(255) PRIMARY KEY,
      doc_id TEXT, user_name TEXT, action TEXT, status TEXT, comment TEXT, 
      timestamp TEXT, company_id VARCHAR(255)
    )`);

    // Seed default admin
    const [userRows] = await pool.query("SELECT * FROM users WHERE email = 'johns@admin.com'");
    if (userRows.length === 0) {
      await pool.query("INSERT INTO users (id, name, email, password, role, company_id) VALUES (?,?,?,?,?,?)",
        ['admin_johns', 'John Admin', 'johns@admin.com', '123ewqasd', 'admin', 'primary']);
    }
    const [companyRows] = await pool.query("SELECT * FROM company WHERE id = 'primary'");
    if (companyRows.length === 0) {
      await pool.query("INSERT INTO company (id, name, address, phone, email, tax_id, currency, accent) VALUES (?,?,?,?,?,?,?,?)",
        ['primary', 'FinProx Enterprise', 'Main HQ', '+971 000 000', 'johns@admin.com', 'TRN-001', 'AED', '#d97706']);
    }

  } catch (err) {
    console.error('MySQL Init Error:', err);
    process.exit(1);
  }
}

initDB();

// API Routes
const tables = ['vendors', 'clients', 'quotations', 'lpos', 'grns', 'invoices', 'payments', 'users', 'audit'];

// Generic GET all for a company
app.get('/api/:table', async (req, res) => {
  const { table } = req.params;
  const { cid } = req.query;
  if (!tables.includes(table)) return res.status(400).send('Invalid table');
  
  try {
    const [rows] = await pool.query(`SELECT * FROM ${table} ${cid ? 'WHERE company_id = ?' : ''}`, cid ? [cid] : []);
    const parsed = rows.map(r => {
      const row = {...r};
      if (row.items && typeof row.items === 'string') {
        try { row.items = JSON.parse(row.items); } catch(e) {}
      }
      if (row.attachments && typeof row.attachments === 'string') {
        try { row.attachments = JSON.parse(row.attachments); } catch(e) {}
      }
      return row;
    });
    res.json(parsed);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Generic POST/PUT (upsert)
app.post('/api/:table', async (req, res) => {
  const { table } = req.params;
  const data = req.body;
  if (!tables.includes(table) && table !== 'company') return res.status(400).send('Invalid table');

  const keys = Object.keys(data);
  const values = keys.map(k => typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k]);
  const placeholders = keys.map(() => '?').join(',');
  const updates = keys.map(k => `${k}=VALUES(${k})`).join(',');

  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders}) 
               ON DUPLICATE KEY UPDATE ${updates}`;

  try {
    await pool.query(sql, values);
    res.json({success: true, id: data.id});
  } catch (err) {
    console.error('Upsert Error:', err);
    res.status(500).json({error: err.message});
  }
});

// Get Company
app.get('/api/company/:id', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM company WHERE id = ?", [req.params.id]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt:', email, password ? '[HIDDEN]' : 'no password');
  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ? AND password = ?", [email, password]);
    console.log('Found users:', rows.length);
    if (rows.length === 0) return res.status(401).json({error: 'Invalid credentials'});
    res.json(rows[0]);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({error: err.message});
  }
});

// Delete
app.delete('/api/:table/:id', async (req, res) => {
  const { table, id } = req.params;
  if (!tables.includes(table)) return res.status(400).send('Invalid table');
  try {
    await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
    res.json({success: true});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

