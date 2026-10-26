-- Two permissions split from wider access (docs/specs/role-service.md):
-- item_sets.read (See Item Sets), which every signed-in user had, and
-- item_prices.manage (Change Item prices), which catalogue.manage included.
-- Every role keeps what it allowed: all but Equipment Assignments, which only
-- adds Equipment & Furniture, may see Item Sets, and every role that manages
-- the catalogue may change prices. Same grants as role.builtins.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'item_sets.read' FROM roles WHERE key IS DISTINCT FROM 'equipment'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT role_id, 'item_prices.manage' FROM role_permissions WHERE permission = 'catalogue.manage'
ON CONFLICT DO NOTHING;
