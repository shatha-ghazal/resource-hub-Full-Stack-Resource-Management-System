
import React, { useEffect, useMemo, useState } from 'react';
import './App.css';

const API = '/api';

async function readApiResponse(res) {
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const responseText = await res.text();

    throw new Error(
      `Expected JSON but received ${contentType || 'an unknown response'}. ` +
      `Check your API connection. Response: ${responseText.slice(0, 100)}`
    );
  }

  return res.json();
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('resourcehub_user')) || null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(
    () => sessionStorage.getItem('resourcehub_token') || ''
  );

  const [isSignup, setIsSignup] = useState(false);
  const [authForm, setAuthForm] = useState({
    full_name: '',
    email: '',
    password: ''
  });

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [resources, setResources] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(false);

  const [bookingForm, setBookingForm] = useState({
    resource_id: '',
    start_time: '',
    end_time: '',
    purpose: ''
  });

  const [newResource, setNewResource] = useState({
    name: '',
    category: 'Facility',
    location: '',
    capacity_or_qty: 1
  });

  const isAdmin = user?.role === 'admin';

  const apiFetch = async (url, options = {}) => {
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  return fetch(`${API}${url}`, {
    ...options,
    headers,
    cache: 'no-store'
  });
};

  const showMessage = (text, type = 'success') => {
    setMessage(text);
    setMessageType(type);
  };

  const loadResources = async () => {
    try {
      const res = await apiFetch('/resources');
      const data = await readApiResponse(res);

      if (!res.ok) {
        throw new Error(data.error || 'Could not load resources');
      }

      setResources(data);

      setBookingForm(prev => ({
        ...prev,
        resource_id: prev.resource_id || (data[0] ? String(data[0].id) : '')
      }));
    } catch (err) {
      showMessage(err.message || 'Unable to load resources', 'error');
    }
  };

  const loadReservations = async () => {
    try {
      const res = await apiFetch('/reservations');
      const data = await readApiResponse(res);

      if (!res.ok) {
        throw new Error(data.error || 'Could not load reservations');
      }

      setReservations(data);
    } catch (err) {
      showMessage(err.message || 'Unable to load reservations', 'error');
    }
  };

  useEffect(() => {
    if (user && token) {
      loadResources();
      loadReservations();
    }

    // The API calls intentionally run when the authenticated session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const endpoint = isSignup ? '/auth/signup' : '/auth/login';

      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });

      const data = await readApiResponse(res);

      if (!res.ok) {
        showMessage(data.error || 'Authentication failed', 'error');
        return;
      }

      if (isSignup) {
        showMessage(data.message || 'Account created. Please sign in.');
        setIsSignup(false);
        setAuthForm(prev => ({ ...prev, password: '' }));
      } else {
        sessionStorage.setItem('resourcehub_token', data.token);
        sessionStorage.setItem('resourcehub_user', JSON.stringify(data.user));

        setToken(data.token);
        setUser(data.user);
        setAuthForm({ full_name: '', email: '', password: '' });
      }
    } catch (err) {
      showMessage(err.message || 'Cannot connect to the ResourceHub server.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!bookingForm.resource_id) {
      showMessage('Please select a resource.', 'error');
      return;
    }

    if (new Date(bookingForm.end_time) <= new Date(bookingForm.start_time)) {
      showMessage('End date and time must be after the start date and time.', 'error');
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch('/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingForm)
      });

      const data = await readApiResponse(res);

      if (!res.ok) {
        showMessage(data.error || 'Reservation failed.', 'error');
        return;
      }

      showMessage('Your reservation has been confirmed.');

      setBookingForm(prev => ({
        ...prev,
        start_time: '',
        end_time: '',
        purpose: ''
      }));

      await loadReservations();
    } catch (err) {
      showMessage(err.message || 'Cannot connect to the ResourceHub server.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddResource = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await apiFetch('/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newResource)
      });

      const data = await readApiResponse(res);

      if (!res.ok) {
        showMessage(data.error || 'Could not add resource.', 'error');
        return;
      }

      showMessage('Resource added to the catalog.');

      setNewResource({
        name: '',
        category: 'Facility',
        location: '',
        capacity_or_qty: 1
      });

      await loadResources();
    } catch (err) {
      showMessage(err.message || 'Cannot connect to the ResourceHub server.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const cancelReservation = async (id) => {
    try {
      const res = await apiFetch(`/reservations/${id}`, {
        method: 'DELETE'
      });

      const data = await readApiResponse(res);

      if (!res.ok) {
        showMessage(data.error || 'Cancellation failed.', 'error');
        return;
      }

      window.alert('Reservation cancelled successfully!');
      showMessage('Reservation cancelled successfully!');

      await loadReservations();
    } catch (err) {
      showMessage(err.message || 'Cannot connect to the ResourceHub server.', 'error');
    }
  };

  const signOut = () => {
    sessionStorage.removeItem('resourcehub_token');
    sessionStorage.removeItem('resourcehub_user');

    setUser(null);
    setToken('');
    setResources([]);
    setReservations([]);
    setMessage('');
    setFilter('All');
  };

  const visibleResources = useMemo(
    () => filter === 'All'
      ? resources
      : resources.filter(item => item.category === filter),
    [resources, filter]
  );

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark">RH</div>
          <p className="eyebrow">FACILITY & EQUIPMENT MANAGEMENT</p>
          <h1>ResourceHub</h1>
          <p className="auth-subtitle">
            A simpler way to manage shared spaces and equipment.
          </p>

          {message && (
            <div className={`notice notice-${messageType}`} role="status">
              {message}
            </div>
          )}

          <form onSubmit={handleAuth} className="auth-form">
            {isSignup && (
              <label className="field">
                <span>Full name</span>
                <input
                  type="text"
                  placeholder="Your full name"
                  required
                  value={authForm.full_name}
                  onChange={e =>
                    setAuthForm({ ...authForm, full_name: e.target.value })
                  }
                />
              </label>
            )}

            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                placeholder="name@example.com"
                required
                value={authForm.email}
                onChange={e =>
                  setAuthForm({ ...authForm, email: e.target.value })
                }
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                placeholder="Enter your password"
                required
                value={authForm.password}
                onChange={e =>
                  setAuthForm({ ...authForm, password: e.target.value })
                }
              />
            </label>

            <button
              className="button button-primary button-full"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New to ResourceHub?'}{' '}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setIsSignup(!isSignup);
                setMessage('');
              }}
            >
              {isSignup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="top-banner">
        <div className="top-banner-inner">
          <div className="brand-copy">
            <div className="brand-line">
              <span className="brand-symbol">RH</span>
              <h1>ResourceHub</h1>
              {isAdmin && (
                <span className="admin-pill">Administrator</span>
              )}
            </div>

            <p>Facility &amp; Equipment Reservation Manager</p>
            <p className="welcome-line">Welcome, {user.full_name}</p>
          </div>

          <button className="button button-logout" onClick={signOut}>
            Sign out <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>

      <div className="page-content">
        {message && (
          <div className={`notice page-notice notice-${messageType}`} role="status">
            <span>{message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setMessage('')}
            >
              ×
            </button>
          </div>
        )}

        <section className="section-block catalog-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">EXPLORE WHAT'S AVAILABLE</p>
              <h2>Resource catalog</h2>
              <p className="section-description">
                Browse facilities and equipment available to reserve.
              </p>
            </div>

            <span className="count-chip">
              {visibleResources.length}{' '}
              {visibleResources.length === 1 ? 'resource' : 'resources'}
            </span>
          </div>

          <div className="filter-row" aria-label="Filter resources">
            {['All', 'Facility', 'Equipment'].map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`filter-button ${filter === tab ? 'filter-active' : ''}`}
                aria-pressed={filter === tab}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="resource-grid">
            {visibleResources.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">⌕</span>
                <h3>No resources found</h3>
                <p>There are no resources in this category yet.</p>
              </div>
            ) : (
              visibleResources.map(item => (
                <article className="resource-card" key={item.id}>
                  <div
                    className={`resource-icon ${
                      item.category === 'Facility'
                        ? 'facility-icon'
                        : 'equipment-icon'
                    }`}
                  >
                    {item.category === 'Facility' ? '⌂' : '▣'}
                  </div>

                  <div className="resource-card-content">
                    <span
                      className={`category-tag ${
                        item.category === 'Facility'
                          ? 'tag-facility'
                          : 'tag-equipment'
                      }`}
                    >
                      {item.category}
                    </span>

                    <h3>{item.name}</h3>

                    <p className="resource-location">
                      <span aria-hidden="true">⌖</span>{' '}
                      {item.location || 'Location not specified'}
                    </p>

                    <p className="resource-capacity">
                      {item.category === 'Facility' ? 'Capacity' : 'Quantity'}:{' '}
                      {item.capacity_or_qty}
                    </p>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="booking-section">
          <div className="booking-card">
            <div className="booking-heading">
              <div className="booking-icon">▦</div>

              <div>
                <p className="eyebrow">PLAN YOUR NEXT SESSION</p>
                <h2>Reserve a resource</h2>
                <p>Choose a resource and tell us when you need it.</p>
              </div>
            </div>

            <form onSubmit={handleBooking} className="booking-form">
              <label className="field">
                <span>Resource</span>

                <select
                  value={bookingForm.resource_id}
                  onChange={e =>
                    setBookingForm({
                      ...bookingForm,
                      resource_id: e.target.value
                    })
                  }
                  required
                  disabled={resources.length === 0}
                >
                  {resources.length === 0 && (
                    <option value="">No resources available</option>
                  )}

                  {resources.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {item.category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Start date &amp; time</span>

                <input
                  type="datetime-local"
                  required
                  value={bookingForm.start_time}
                  onChange={e =>
                    setBookingForm({
                      ...bookingForm,
                      start_time: e.target.value
                    })
                  }
                />
              </label>

              <label className="field">
                <span>End date &amp; time</span>

                <input
                  type="datetime-local"
                  required
                  value={bookingForm.end_time}
                  onChange={e =>
                    setBookingForm({
                      ...bookingForm,
                      end_time: e.target.value
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Purpose</span>

                <textarea
                  rows="3"
                  placeholder="e.g. Executive meeting, project workshop"
                  required
                  value={bookingForm.purpose}
                  onChange={e =>
                    setBookingForm({
                      ...bookingForm,
                      purpose: e.target.value
                    })
                  }
                />
              </label>

              <button
                className="button button-primary button-full booking-submit"
                type="submit"
                disabled={loading || resources.length === 0}
              >
                {loading ? 'Processing…' : 'Confirm reservation'}
                <span aria-hidden="true">→</span>
              </button>
            </form>
          </div>
        </section>

        {isAdmin && (
          <section className="admin-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ADMINISTRATOR TOOLS</p>
                <h2>Add a resource</h2>
                <p className="section-description">
                  Only administrators can add facilities and equipment.
                </p>
              </div>

              <span className="admin-pill admin-pill-light">Admin only</span>
            </div>

            <form onSubmit={handleAddResource} className="admin-form">
              <label className="field">
                <span>Resource name</span>

                <input
                  type="text"
                  placeholder="e.g. Executive Conference Room"
                  required
                  value={newResource.name}
                  onChange={e =>
                    setNewResource({ ...newResource, name: e.target.value })
                  }
                />
              </label>

              <label className="field">
                <span>Category</span>

                <select
                  value={newResource.category}
                  onChange={e =>
                    setNewResource({
                      ...newResource,
                      category: e.target.value
                    })
                  }
                >
                  <option value="Facility">Facility / Room</option>
                  <option value="Equipment">Equipment / Gear</option>
                </select>
              </label>

              <label className="field">
                <span>Location</span>

                <input
                  type="text"
                  placeholder="Building and room"
                  required
                  value={newResource.location}
                  onChange={e =>
                    setNewResource({
                      ...newResource,
                      location: e.target.value
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Capacity / quantity</span>

                <input
                  type="number"
                  min="1"
                  required
                  value={newResource.capacity_or_qty}
                  onChange={e =>
                    setNewResource({
                      ...newResource,
                      capacity_or_qty: Number(e.target.value)
                    })
                  }
                />
              </label>

              <button
                className="button button-secondary"
                type="submit"
                disabled={loading}
              >
                Add to catalog
              </button>
            </form>
          </section>
        )}

        <section className="section-block reservations-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR BOOKINGS</p>
              <h2>My scheduled reservations</h2>
              <p className="section-description">
                Review and manage your upcoming resource bookings.
              </p>
            </div>

            <span className="count-chip">
              {reservations.length}{' '}
              {reservations.length === 1 ? 'booking' : 'bookings'}
            </span>
          </div>

          {reservations.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">▦</span>
              <h3>No reservations yet</h3>
              <p>Your confirmed bookings will appear here.</p>
            </div>
          ) : (
            <div className="reservation-grid">
              {reservations.map(item => (
                <article className="reservation-card" key={item.id}>
                  <div className="reservation-card-top">
                    <span
                      className={`category-tag ${
                        item.category === 'Facility'
                          ? 'tag-facility'
                          : 'tag-equipment'
                      }`}
                    >
                      {item.category}
                    </span>

                    <span className="status-tag">
                      {item.status || 'Approved'}
                    </span>
                  </div>

                  <h3>{item.resource_name}</h3>
                  <p className="resource-location">{item.location}</p>

                  <div className="reservation-details">
                    <div>
                      <span>Starts</span>
                      <strong>
                        {new Date(item.start_time).toLocaleString()}
                      </strong>
                    </div>

                    <div>
                      <span>Ends</span>
                      <strong>
                        {new Date(item.end_time).toLocaleString()}
                      </strong>
                    </div>

                    <div>
                      <span>Purpose</span>
                      <strong>{item.purpose}</strong>
                    </div>
                  </div>

                  <button
                    className="button button-cancel"
                    onClick={() => cancelReservation(item.id)}
                  >
                    Cancel reservation
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="page-footer">
          ResourceHub <span>•</span> Facility &amp; Equipment Reservation Manager
        </footer>
      </div>
    </main>
  );
}
