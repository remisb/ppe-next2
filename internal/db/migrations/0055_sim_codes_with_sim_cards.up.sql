-- Show PIN and PUK is for whoever sees SIM cards (WARE-37, ADR 0005
-- amendment): the route takes sim_cards.read, with no recent sign-in, and the
-- separate permission sim_codes.read (0041, the Administrator's) is retired.
-- The API already drops a key the code does not know; this removes the rows.
DELETE FROM role_permissions WHERE permission = 'sim_codes.read';
