
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'resourcehub-test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { app, pool } = require('../server');

let server;
let baseUrl;

before(async () => {
  pool.query = async (sql, values) => {
    if (sql.includes('SELECT * FROM resources')) {
      return {
        rows: [
          {
            id: 1,
            name: 'Test Conference Room',
            category: 'Facility',
            location: 'Test Floor',
            capacity_or_qty: 10
          }
        ]
      };
    }

    if (sql.includes('INSERT INTO users')) {
      if (values[1] === 'duplicate@example.com') {
        const error = new Error('Duplicate email');
        error.code = '23505';
        throw error;
      }

      return {
        rows: [],
        rowCount: 1
      };
    }

    throw new Error(`Unexpected database query: ${sql}`);
  };

  server = app.listen(0);

  await new Promise((resolve) => {
    server.once('listening', resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/resources rejects requests without authentication', async () => {
  const response = await fetch(`${baseUrl}/api/resources`);

  assert.equal(response.status, 401);

  const body = await response.json();
  assert.equal(body.error, 'Please sign in to continue.');
});

test('GET /api/resources returns resources to an authenticated user', async () => {
  const token = jwt.sign(
    { id: 1, email: 'member@example.com', role: 'member' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  const response = await fetch(`${baseUrl}/api/resources`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.length, 1);
  assert.equal(body[0].name, 'Test Conference Room');
});
test('POST /api/resources rejects members without administrator access', async () => {
  const token = jwt.sign(
    { id: 1, email: 'member@example.com', role: 'member' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  const response = await fetch(`${baseUrl}/api/resources`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Unauthorized Test Resource',
      category: 'Facility',
      location: 'Test Floor',
      capacity_or_qty: 5
    })
  });

  assert.equal(response.status, 403);

  const body = await response.json();
  assert.equal(body.error, 'Administrator access is required.');
});
test('POST /api/reservations rejects an end time before the start time', async () => {
  const token = jwt.sign(
    { id: 1, email: 'member@example.com', role: 'member' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  const response = await fetch(`${baseUrl}/api/reservations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      resource_id: 1,
      start_time: '2026-12-10T15:00:00',
      end_time: '2026-12-10T14:00:00',
      purpose: 'Test reservation'
    })
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(body.error, 'End time must be after start time.');
});
test('POST /api/auth/signup rejects passwords shorter than 8 characters', async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Test User',
      email: 'testuser@example.com',
      password: '12345'
    })
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(
    body.error,
    'Enter your name, a valid email, and a password with at least 8 characters.'
  );
});

test('POST /api/auth/signup creates an account with a valid password', async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'New Test User',
      email: 'newtestuser@example.com',
      password: 'TestPass123'
    })
  });

  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.message, 'Account created. Please sign in.');
});

test('POST /api/auth/signup rejects an already registered email', async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Duplicate Test User',
      email: 'duplicate@example.com',
      password: 'TestPass123'
    })
  });

  assert.equal(response.status, 409);

  const body = await response.json();
  assert.equal(body.error, 'This email is already registered.');
});
