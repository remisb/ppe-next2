DELETE FROM role_permissions WHERE permission = 'sim_codes.read';
DROP INDEX assets_sim_no_live_idx;
CREATE UNIQUE INDEX assets_sim_no_live_idx ON assets (upper(replace(sim_no, ' ', '')))
    WHERE deleted_at IS NULL AND sim_no IS NOT NULL;
DROP TABLE asset_sim_codes;
