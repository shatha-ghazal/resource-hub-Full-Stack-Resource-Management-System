
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'resourcehub-test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { app, pool } = require('../server');

let server;
let baseUrl;

before(async () => {
  pool.query = async (sql) => {
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
