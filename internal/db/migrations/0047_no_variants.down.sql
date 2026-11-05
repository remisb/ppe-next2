ALTER TABLE launcher_versions ADD COLUMN screens TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE launcher_channel_choices DROP CONSTRAINT launcher_channel_choices_channel_check;
ALTER TABLE launcher_channels
    DROP CONSTRAINT launcher_channels_name_check,
    ADD CONSTRAINT launcher_channels_name_check CHECK (name ~ '^[a-z][a-z0-9-]{1,30}$'),
    ADD COLUMN label_en TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_channels_label_en_check CHECK (char_length(label_en) <= 60),
    ADD COLUMN label_lt TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_channels_label_lt_check CHECK (char_length(label_lt) <= 60),
    ADD COLUMN label_ru TEXT NOT NULL DEFAULT '' CONSTRAINT launcher_channels_label_ru_check CHECK (char_length(label_ru) <= 60),
    ADD COLUMN any_of TEXT[] NOT NULL DEFAULT '{}';
