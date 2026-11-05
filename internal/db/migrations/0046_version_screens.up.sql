-- App Launcher (ADR 0006): the first-level screens a published build's router
-- uses (its manifest's "screens", such as Scan SIMs' find), so a variant is
-- never named like one: /apps/<slug>/<name>/ opens a channel before a screen.
-- Builds published before this have none.
ALTER TABLE launcher_versions ADD COLUMN screens TEXT[] NOT NULL DEFAULT '{}';
