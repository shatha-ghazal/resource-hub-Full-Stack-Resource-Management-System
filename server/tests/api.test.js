
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'resourcehub-test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { app, pool } = require('../server');

let server;
let baseUrl;
let reservationConflict = false;

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

    if (sql.includes('INSERT INTO resources')) {
      return {
        rows: [
          {
            id: 2,
            name: values[0],
            category: values[1],
            location: values[2],
            capacity_or_qty: values[3]
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes('DELETE FROM reservations')) {
      assert.equal(values[0], 1);
      assert.equal(values[1], 1);

      return {
        rows: [],
        rowCount: 0
      };
    }

    if (sql.includes('SELECT id, full_name, email, password, role FROM users')) {
      return {
        rows: [
          {
            id: 2,
            full_name: 'Login Test User',
            email: values[0],
            password: 'TestPass123',
            role: 'member'
          }
        ]
      };
    }

    if (sql.includes('UPDATE users')) {
      return {
        rows: [],
        rowCount: 1
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
  pool.connect = async () => ({
    query: async (sql, values) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.includes('pg_advisory_xact_lock')) {
        return { rows: [] };
      }

      if (sql.includes('SELECT id FROM reservations')) {
        return {
          rows: reservationConflict ? [{ id: 1 }] : []
        };
      }

      if (sql.includes('INSERT INTO reservations')) {
        return {
          rows: [
            {
              id: 2,
              user_id: values[0],
              resource_id: values[1],
              start_time: values[2],
              end_time: values[3],
              purpose: values[4],
              status: 'pending'
            }
          ]
        };
      }

      throw new Error(`Unexpected transaction query: ${sql}`);
    },
    release: () => {}
  });
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

test('POST /api/resources allows administrators to create a resource', async () => {
  const token = jwt.sign(
    { id: 2, email: 'admin@resourcehub.com', role: 'admin' },
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
      name: 'Admin Test Room',
      category: 'Facility',
      location: 'Test Floor 2',
      capacity_or_qty: 12
    })
  });

  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.name, 'Admin Test Room');
  assert.equal(body.category, 'Facility');
  assert.equal(body.location, 'Test Floor 2');
  assert.equal(body.capacity_or_qty, 12);
});

test('POST /api/resources rejects an invalid category', async () => {
  const token = jwt.sign(
    { id: 2, email: 'admin@resourcehub.com', role: 'admin' },
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
      name: 'Invalid Test Resource',
      category: 'Furniture',
      location: 'Test Floor',
      capacity_or_qty: 5
    })
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(
    body.error,
    'Provide a name, valid category, location, and quantity/capacity of at least 1.'
  );
});

test('POST /api/resources rejects a quantity below 1', async () => {
  const token = jwt.sign(
    { id: 2, email: 'admin@resourcehub.com', role: 'admin' },
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
      name: 'Zero Quantity Resource',
      category: 'Equipment',
      location: 'IT Supply Desk',
      capacity_or_qty: 0
    })
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(
    body.error,
    'Provide a name, valid category, location, and quantity/capacity of at least 1.'
  );
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

test('POST /api/reservations rejects an overlapping reservation', async () => {
  reservationConflict = true;

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
      start_time: '2026-12-10T14:00:00',
      end_time: '2026-12-10T15:00:00',
      purpose: 'Test overlapping reservation'
    })
  });

  reservationConflict = false;

  assert.equal(response.status, 409);

  const body = await response.json();
  assert.equal(
    body.error,
    'Time slot conflict: this resource is already reserved.'
  );
});

test('POST /api/reservations creates a reservation when the time slot is available', async () => {
  reservationConflict = false;

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
      start_time: '2026-12-11T14:00:00',
      end_time: '2026-12-11T15:00:00',
      purpose: 'Test available reservation'
    })
  });

  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.user_id, 1);
  assert.equal(body.resource_id, 1);
  assert.equal(body.purpose, 'Test available reservation');
});

test('DELETE /api/reservations rejects cancellation by a user who does not own the reservation', async () => {
  const token = jwt.sign(
    { id: 1, email: 'member@example.com', role: 'member' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  const response = await fetch(`${baseUrl}/api/reservations/1`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  assert.equal(response.status, 404);

  const body = await response.json();
  assert.equal(body.error, 'Reservation not found.');
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

test('POST /api/auth/login accepts valid credentials', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'loginuser@example.com',
      password: 'TestPass123'
    })
  });

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.ok(body.token);
});

test('POST /api/auth/login rejects an incorrect password', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'loginuser@example.com',
      password: 'WrongPassword123'
    })
  });

  assert.equal(response.status, 401);

  const body = await response.json();
  assert.equal(body.error, 'Invalid email or password.');
});
