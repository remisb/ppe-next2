-- SIM cards get permissions of their own (docs/specs/asset-service.md,
-- "Access"): sim_cards.read (See SIM Cards), which every signed-in user had,
-- and sim_cards.manage (Manage SIMs), which assets.manage included;
-- assets.manage now changes Equipment & Furniture only. Every role keeps what
-- it allowed: all but the add-on roles Equipment Assignments, Testers and
-- Personnel Documents may see SIM cards, and every role that manages assets
-- may manage SIMs. Same grants as role.builtins.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'sim_cards.read' FROM roles
WHERE key IS NULL OR key NOT IN ('equipment', 'testers', 'personnel')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT role_id, 'sim_cards.manage' FROM role_permissions WHERE permission = 'assets.manage'
ON CONFLICT DO NOTHING;
