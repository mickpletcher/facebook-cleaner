CREATE TABLE places (
    place_id INTEGER PRIMARY KEY,
    place_fingerprint TEXT NOT NULL UNIQUE,
    place_name TEXT,
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE post_places (
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    place_id INTEGER NOT NULL REFERENCES places(place_id) ON DELETE RESTRICT,
    first_collected_at_utc TEXT NOT NULL,
    last_collected_at_utc TEXT NOT NULL,
    PRIMARY KEY (post_id, place_id)
) STRICT;

CREATE INDEX places_name_idx ON places(place_name);
CREATE INDEX post_places_place_idx ON post_places(place_id);

UPDATE schema_metadata SET value = '2' WHERE key = 'schema_version';
