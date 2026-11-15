DELETE FROM role_permissions WHERE permission = 'suppliers.manage';
ALTER TABLE catalogue_items DROP COLUMN supplier_id;
DROP TABLE suppliers;
