require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-this-secret';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

const ADMIN_NAME = 'Joseph Alex';
const ADMIN_EMAIL = 'admin@resourcehub.com';
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || '12345';

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'member'
    );

    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL,
      location VARCHAR(100),
      capacity_or_qty INT DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      purpose VARCHAR(255),
      status VARCHAR(20) DEFAULT 'approved',
      CONSTRAINT valid_reservation_period CHECK (end_time > start_time)
    );
  `);

  // Ensure the configured administrator exists and always has a hashed password.
  const adminHash = await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 12);
  await pool.query(
    `INSERT INTO users (full_name, email, password, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         password = EXCLUDED.password,
         role = 'admin'`,
    [ADMIN_NAME, ADMIN_EMAIL, adminHash]
  );

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM resources');
  if (rows[0].count === 0) {
    await pool.query(`
      INSERT INTO resources (name, category, location, capacity_or_qty) VALUES
      ('Executive Conference Room A', 'Facility', 'Floor 2, West Wing', 12),
      ('Innovation Brainstorm Pod', 'Facility', 'Floor 1, Hub Central', 6),
      ('4K Laser Projector Kit', 'Equipment', 'IT Supply Desk', 3),
      ('Sony Alpha DSLR Camera Bundle', 'Equipment', 'Media Lab B', 2)
    `);
  }

  console.log('ResourceHub database initialized.');
}

// API requests wait until schema and administrator setup are complete.
const dbReady = initDatabase();
app.use('/api', async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch (err) {
    console.error('Database initialization failed:', err);
    res.status(503).json({ error: 'Database is not ready. Check the server configuration.' });
  }
});

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin' || req.auth?.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }
  next();
}

/* Authentication */
app.post('/api/auth/signup', async (req, res) => {
  const full_name = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!full_name || !email || password.length < 8) {
    return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 8 characters.' });
  }
  if (email === ADMIN_EMAIL) {
    return res.status(403).json({ error: 'This email is reserved for the administrator.' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (full_name, email, password, role) VALUES ($1, $2, $3, $4)',
      [full_name, email, hash, 'member']
    );
    res.status(201).json({ message: 'Account created. Please sign in.' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This email is already registered.' });
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Could not create your account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  try {
    const { rows } = await pool.query(
      'SELECT id, full_name, email, password, role FROM users WHERE email = $1',
      [email]
    );
    const dbUser = rows[0];
    if (!dbUser) return res.status(401).json({ error: 'Invalid email or password.' });

    let validPassword = false;
    if (dbUser.password.startsWith('$2')) {
      validPassword = await bcrypt.compare(password, dbUser.password);
    } else {
      // One-time compatibility for accounts created by the previous plaintext-password version.
      validPassword = password === dbUser.password;
      if (validPassword) {
        const upgradedHash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [upgradedHash, dbUser.id]);
      }
    }

    if (!validPassword) return res.status(401).json({ error: 'Invalid email or password.' });

    const user = {
      id: dbUser.id,
      full_name: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role || 'member'
    };
    res.json({ user, token: createToken(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

/* Resources */
app.get('/api/resources', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resources ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('Resource fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch resources.' });
  }
});

app.post('/api/resources', authenticateToken, requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '');
  const location = String(req.body.location || '').trim();
  const capacity_or_qty = Number(req.body.capacity_or_qty || 1);

  if (!name || !['Facility', 'Equipment'].includes(category) || !location ||
      !Number.isInteger(capacity_or_qty) || capacity_or_qty < 1) {
    return res.status(400).json({ error: 'Provide a name, valid category, location, and quantity/capacity of at least 1.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO resources (name, category, location, capacity_or_qty)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, category, location, capacity_or_qty]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Add resource error:', err);
    res.status(500).json({ error: 'Failed to add the resource.' });
  }
});

/* Reservations */
app.get('/api/reservations', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.start_time, r.end_time, r.purpose, r.status,
              res.name AS resource_name, res.category, res.location
       FROM reservations r
       JOIN resources res ON r.resource_id = res.id
       WHERE r.user_id = $1
       ORDER BY r.start_time DESC`,
      [req.auth.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Reservation fetch error:', err);
    res.status(500).json({ error: 'Failed to load reservations.' });
  }
});

app.post('/api/reservations', authenticateToken, async (req, res) => {
  const resource_id = Number(req.body.resource_id);
  const { start_time, end_time } = req.body;
  const purpose = String(req.body.purpose || '').trim();

  if (!Number.isInteger(resource_id) || !start_time || !end_time || !purpose) {
    return res.status(400).json({ error: 'Complete all reservation fields.' });
  }
  if (new Date(end_time) <= new Date(start_time)) {
    return res.status(400).json({ error: 'End time must be after start time.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize overlapping checks per resource to reduce simultaneous double bookings.
    await client.query('SELECT pg_advisory_xact_lock($1)', [resource_id]);

    const conflictCheck = await client.query(
      `SELECT id FROM reservations
       WHERE resource_id = $1 AND status = 'approved'
         AND start_time < $2 AND end_time > $3
       LIMIT 1`,
      [resource_id, end_time, start_time]
    );
    if (conflictCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Time slot conflict: this resource is already reserved.' });
    }

    const { rows } = await client.query(
      `INSERT INTO reservations (user_id, resource_id, start_time, end_time, purpose)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.auth.id, resource_id, start_time, end_time, purpose]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create reservation error:', err);
    res.status(500).json({ error: 'Failed to create reservation.' });
  } finally {
    client.release();
  }
});

app.delete('/api/reservations/:id', authenticateToken, async (req, res) => {
  const reservationId = Number(req.params.id);
  if (!Number.isInteger(reservationId)) return res.status(400).json({ error: 'Invalid reservation ID.' });

  try {
    const result = await pool.query(
      'DELETE FROM reservations WHERE id = $1 AND user_id = $2 RETURNING id',
      [reservationId, req.auth.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Reservation not found.' });
    res.json({ success: true, message: 'Reservation cancelled successfully!' });
  } catch (err) {
    console.error('Cancel reservation error:', err);
    res.status(500).json({ error: 'Failed to cancel reservation.' });
  }
});

/* Serve the React build in production */
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => console.log(`ResourceHub server running on port ${PORT}`));
