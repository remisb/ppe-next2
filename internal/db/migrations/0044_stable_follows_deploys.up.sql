-- App Launcher (ADR 0006): an app whose Stable moves with every deploy, as
-- Preview does, for apps no one tries before everyone gets them. Off, a
-- deploy reaches only Preview until someone chooses Make Stable.
ALTER TABLE launcher_apps ADD COLUMN stable_follows_deploys BOOLEAN NOT NULL DEFAULT false;
