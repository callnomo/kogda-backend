CREATE TABLE IF NOT EXISTS single_use_links (
  id SERIAL PRIMARY KEY,
  meeting_type_id INTEGER NOT NULL REFERENCES meeting_types(id) ON DELETE CASCADE,
  token VARCHAR(32) NOT NULL UNIQUE,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMP,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_single_use_links_token ON single_use_links(token);
CREATE INDEX IF NOT EXISTS idx_single_use_links_meeting_type_id ON single_use_links(meeting_type_id);
CREATE INDEX IF NOT EXISTS idx_single_use_links_used ON single_use_links(used);