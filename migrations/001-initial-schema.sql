CREATE TABLE schema_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE profiles (
    profile_id TEXT PRIMARY KEY,
    facebook_profile_id TEXT UNIQUE,
    profile_label TEXT,
    created_at_utc TEXT NOT NULL
) STRICT;

CREATE TABLE collection_sets (
    collection_set_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE RESTRICT,
    export_date TEXT,
    source_fingerprint TEXT NOT NULL,
    root_count INTEGER NOT NULL CHECK (root_count > 0),
    registered_at_utc TEXT NOT NULL,
    UNIQUE (profile_id, source_fingerprint)
) STRICT;

CREATE TABLE import_runs (
    import_run_id TEXT PRIMARY KEY,
    collection_set_id TEXT NOT NULL REFERENCES collection_sets(collection_set_id) ON DELETE RESTRICT,
    started_at_utc TEXT NOT NULL,
    completed_at_utc TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
    records_examined INTEGER NOT NULL DEFAULT 0 CHECK (records_examined >= 0),
    posts_added INTEGER NOT NULL DEFAULT 0 CHECK (posts_added >= 0),
    posts_updated INTEGER NOT NULL DEFAULT 0 CHECK (posts_updated >= 0),
    records_matched INTEGER NOT NULL DEFAULT 0 CHECK (records_matched >= 0),
    records_ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (records_ambiguous >= 0),
    records_skipped INTEGER NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
    error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0)
) STRICT;

CREATE TABLE source_files (
    source_file_id INTEGER PRIMARY KEY,
    import_run_id TEXT NOT NULL REFERENCES import_runs(import_run_id) ON DELETE CASCADE,
    export_root_number INTEGER NOT NULL CHECK (export_root_number > 0),
    relative_path TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    record_count INTEGER CHECK (record_count IS NULL OR record_count >= 0),
    parse_status TEXT NOT NULL CHECK (parse_status IN ('pending', 'completed', 'partial', 'unsupported', 'failed')),
    UNIQUE (import_run_id, export_root_number, relative_path)
) STRICT;

CREATE TABLE source_records (
    source_record_id INTEGER PRIMARY KEY,
    source_file_id INTEGER NOT NULL REFERENCES source_files(source_file_id) ON DELETE CASCADE,
    record_index INTEGER NOT NULL CHECK (record_index >= 0),
    source_kind TEXT NOT NULL,
    raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
    raw_sha256 TEXT NOT NULL,
    semantic_fingerprint TEXT,
    facebook_post_id TEXT,
    created_timestamp INTEGER,
    parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'partial', 'unsupported', 'failed')),
    match_status TEXT NOT NULL CHECK (match_status IN ('pending', 'matched', 'created', 'ambiguous', 'skipped')),
    UNIQUE (source_file_id, record_index)
) STRICT;

CREATE TABLE posts (
    post_id INTEGER PRIMARY KEY,
    record_id TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE RESTRICT,
    facebook_post_id TEXT,
    direct_post_url TEXT,
    normalized_direct_post_url TEXT,
    created_timestamp INTEGER NOT NULL,
    created_at_utc TEXT NOT NULL,
    post_type TEXT NOT NULL CHECK (post_type IN ('text', 'photo', 'video', 'reel', 'link', 'check_in', 'mixed', 'unknown')),
    post_text TEXT,
    audience TEXT NOT NULL CHECK (audience IN ('public', 'friends', 'only_me', 'custom', 'unknown')),
    audience_status TEXT NOT NULL CHECK (audience_status IN ('confirmed', 'unavailable')),
    original_source_name TEXT,
    original_source_url TEXT,
    facebook_state TEXT NOT NULL CHECK (facebook_state IN ('active', 'archived', 'trash', 'unknown')),
    state_status TEXT NOT NULL CHECK (state_status IN ('confirmed', 'derived', 'unknown')),
    semantic_fingerprint TEXT NOT NULL,
    occurrence_slot INTEGER NOT NULL CHECK (occurrence_slot >= 1),
    identity_version INTEGER NOT NULL CHECK (identity_version >= 1),
    collection_status TEXT NOT NULL CHECK (collection_status IN ('complete', 'partial', 'unavailable')),
    first_collected_at_utc TEXT NOT NULL,
    last_collected_at_utc TEXT NOT NULL,
    last_verified_at_utc TEXT,
    UNIQUE (profile_id, semantic_fingerprint, occurrence_slot),
    CHECK (
        (direct_post_url IS NULL AND normalized_direct_post_url IS NULL)
        OR (direct_post_url IS NOT NULL AND normalized_direct_post_url IS NOT NULL)
    )
) STRICT;

CREATE UNIQUE INDEX posts_profile_facebook_post_id_unique
    ON posts(profile_id, facebook_post_id)
    WHERE facebook_post_id IS NOT NULL;

CREATE UNIQUE INDEX posts_profile_direct_post_url_unique
    ON posts(profile_id, normalized_direct_post_url)
    WHERE normalized_direct_post_url IS NOT NULL;

CREATE TABLE post_observations (
    post_observation_id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    source_record_id INTEGER NOT NULL UNIQUE REFERENCES source_records(source_record_id) ON DELETE CASCADE,
    match_rule TEXT NOT NULL,
    match_rank INTEGER NOT NULL CHECK (match_rank >= 1),
    matched_at_utc TEXT NOT NULL,
    changed_canonical_post INTEGER NOT NULL CHECK (changed_canonical_post IN (0, 1))
) STRICT;

CREATE TABLE media (
    media_id INTEGER PRIMARY KEY,
    reference_fingerprint TEXT NOT NULL UNIQUE,
    relative_uri TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'audio', 'unknown')),
    creation_timestamp INTEGER,
    file_size_bytes INTEGER CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    file_sha256 TEXT,
    availability TEXT NOT NULL CHECK (availability IN ('present', 'missing', 'unresolved')),
    metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json))
) STRICT;

CREATE TABLE post_media (
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(media_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    role TEXT NOT NULL CHECK (role IN ('attachment', 'thumbnail', 'cover', 'unknown')),
    PRIMARY KEY (post_id, media_id, role)
) STRICT;

CREATE TABLE post_links (
    post_link_id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (link_type IN ('external', 'source', 'facebook_attachment', 'unknown')),
    source_name TEXT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    UNIQUE (post_id, normalized_url, link_type)
) STRICT;

CREATE TABLE post_state_observations (
    post_state_observation_id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    source_record_id INTEGER NOT NULL REFERENCES source_records(source_record_id) ON DELETE CASCADE,
    facebook_state TEXT NOT NULL CHECK (facebook_state IN ('active', 'archived', 'trash', 'unknown')),
    observed_at_utc TEXT NOT NULL,
    is_confirmed INTEGER NOT NULL CHECK (is_confirmed IN (0, 1)),
    UNIQUE (post_id, source_record_id, facebook_state)
) STRICT;

CREATE TABLE import_errors (
    import_error_id INTEGER PRIMARY KEY,
    import_run_id TEXT NOT NULL REFERENCES import_runs(import_run_id) ON DELETE CASCADE,
    source_file_id INTEGER REFERENCES source_files(source_file_id) ON DELETE CASCADE,
    record_index INTEGER CHECK (record_index IS NULL OR record_index >= 0),
    error_code TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
    created_at_utc TEXT NOT NULL
) STRICT;

CREATE INDEX posts_profile_created_timestamp_idx
    ON posts(profile_id, created_timestamp);

CREATE INDEX posts_profile_type_created_idx
    ON posts(profile_id, post_type, created_timestamp);

CREATE INDEX posts_profile_audience_created_idx
    ON posts(profile_id, audience, created_timestamp);

CREATE INDEX posts_profile_state_created_idx
    ON posts(profile_id, facebook_state, created_timestamp);

CREATE INDEX posts_profile_collection_status_idx
    ON posts(profile_id, collection_status);

CREATE INDEX posts_profile_semantic_fingerprint_idx
    ON posts(profile_id, semantic_fingerprint);

CREATE INDEX source_records_facebook_post_id_idx
    ON source_records(facebook_post_id);

CREATE INDEX source_records_created_fingerprint_idx
    ON source_records(created_timestamp, semantic_fingerprint);

CREATE INDEX post_links_normalized_url_idx
    ON post_links(normalized_url);

CREATE INDEX media_relative_uri_idx
    ON media(relative_uri);

CREATE INDEX import_errors_run_code_idx
    ON import_errors(import_run_id, error_code);

INSERT INTO schema_metadata(key, value) VALUES
    ('schema_version', '1'),
    ('identity_version', '1'),
    ('created_at_utc', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('application_version', '0.1.0');
