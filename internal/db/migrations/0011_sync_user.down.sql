-- Fails while any row still names the sync user as its actor, which is
-- intended: those rows would lose who wrote them.
DELETE FROM users WHERE id = '5e5c0000-0000-4000-8000-000000000001';
