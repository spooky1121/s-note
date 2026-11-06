
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK(json_valid(value_json)));
CREATE TABLE source_files(file_id INTEGER PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL, role TEXT NOT NULL,
 hash_verified INTEGER NOT NULL CHECK(hash_verified IN (0,1)));
CREATE TABLE sheets(sheet_id INTEGER PRIMARY KEY, sheet_key TEXT NOT NULL UNIQUE,
 sheet_name TEXT NOT NULL UNIQUE, sheet_group TEXT NOT NULL, header_row INTEGER,
 header_raw_json TEXT CHECK(header_raw_json IS NULL OR json_valid(header_raw_json)),
 raw_dimension TEXT, blank_rows_in_declared_range INTEGER NOT NULL,
 workbook_file_id INTEGER REFERENCES source_files(file_id));
CREATE TABLE vehicle_records(
 record_no INTEGER PRIMARY KEY, record_id TEXT NOT NULL UNIQUE CHECK(length(record_id)=64),
 row_hash TEXT NOT NULL CHECK(length(row_hash)=64), sheet_id INTEGER NOT NULL REFERENCES sheets(sheet_id),
 source_row INTEGER NOT NULL CHECK(source_row>0), source_year INTEGER NOT NULL CHECK(source_year BETWEEN 1900 AND 2100),
 model_year INTEGER CHECK(model_year IS NULL), original_serial_raw TEXT,
 origin_raw TEXT, sheet_vehicle_group_raw TEXT, table_kind_raw TEXT,
 declared_vehicle_category_raw TEXT, manufacturer_raw TEXT,
 vehicle_name_raw TEXT, type_model_name_raw TEXT, type_raw TEXT, fuel_raw TEXT,
 sourcePriceRaw TEXT, sourcePriceUnitRaw TEXT NOT NULL, unitSource TEXT NOT NULL,
 sourcePriceThousandsRaw TEXT, sourcePriceWonRaw TEXT, priceCellTypeRaw TEXT, wonExact TEXT,
 wonInteger INTEGER, wonRoundingCandidate TEXT, amountParseStatus TEXT NOT NULL,
 requiresReview INTEGER NOT NULL CHECK(requiresReview IN (0,1)), review_reasons_json TEXT NOT NULL CHECK(json_valid(review_reasons_json)),
 fields_raw_json TEXT NOT NULL CHECK(json_valid(fields_raw_json)),
 field_cell_types_raw_json TEXT NOT NULL CHECK(json_valid(field_cell_types_raw_json)),
 fields_typed_json TEXT NOT NULL CHECK(json_valid(fields_typed_json)),
 has_type_name_conflict INTEGER NOT NULL DEFAULT 0 CHECK(has_type_name_conflict IN (0,1)),
 UNIQUE(sheet_id,source_row));
CREATE TABLE modification_records(
 record_no INTEGER PRIMARY KEY, record_id TEXT NOT NULL UNIQUE CHECK(length(record_id)=64),
 row_hash TEXT NOT NULL CHECK(length(row_hash)=64), sheet_id INTEGER NOT NULL REFERENCES sheets(sheet_id),
 source_row INTEGER NOT NULL CHECK(source_row>0), source_year INTEGER NOT NULL CHECK(source_year BETWEEN 1900 AND 2100),
 original_serial_raw TEXT, modification_kind_raw TEXT,
 sourcePriceRaw TEXT, sourcePriceUnitRaw TEXT NOT NULL, unitSource TEXT NOT NULL,
 sourcePriceThousandsRaw TEXT, sourcePriceWonRaw TEXT, priceCellTypeRaw TEXT, wonExact TEXT,
 wonInteger INTEGER, wonRoundingCandidate TEXT, amountParseStatus TEXT NOT NULL,
 requiresReview INTEGER NOT NULL CHECK(requiresReview IN (0,1)), review_reasons_json TEXT NOT NULL CHECK(json_valid(review_reasons_json)),
 fields_raw_json TEXT NOT NULL CHECK(json_valid(fields_raw_json)),
 field_cell_types_raw_json TEXT NOT NULL CHECK(json_valid(field_cell_types_raw_json)),
 fields_typed_json TEXT NOT NULL CHECK(json_valid(fields_typed_json)),
 search_text_raw TEXT NOT NULL, UNIQUE(sheet_id,source_row));
CREATE TABLE type_name_conflicts(
 conflict_id TEXT PRIMARY KEY CHECK(length(conflict_id)=64), manufacturer_raw TEXT NOT NULL,
 manufacturer_cell_type_raw TEXT, type_raw TEXT NOT NULL, type_cell_type_raw TEXT,
 distinct_name_count INTEGER NOT NULL CHECK(distinct_name_count>1), source_record_count INTEGER NOT NULL,
 names_with_types_raw_json TEXT NOT NULL CHECK(json_valid(names_with_types_raw_json)),
 requiresReview INTEGER NOT NULL DEFAULT 1 CHECK(requiresReview=1));
CREATE TABLE type_name_conflict_members(
 conflict_id TEXT NOT NULL REFERENCES type_name_conflicts(conflict_id),
 vehicle_record_no INTEGER NOT NULL REFERENCES vehicle_records(record_no),
 PRIMARY KEY(conflict_id,vehicle_record_no));
CREATE INDEX vehicle_manufacturer_type ON vehicle_records(manufacturer_raw,type_raw);
CREATE INDEX vehicle_name ON vehicle_records(vehicle_name_raw);
CREATE INDEX vehicle_type_model_name ON vehicle_records(type_model_name_raw);
CREATE INDEX vehicle_fuel ON vehicle_records(fuel_raw);
CREATE INDEX vehicle_sheet_source_row ON vehicle_records(sheet_id,source_row);
CREATE VIRTUAL TABLE vehicle_fts USING fts5(manufacturer_raw,vehicle_name_raw,type_model_name_raw,type_raw,fuel_raw,
 content='vehicle_records',content_rowid='record_no',tokenize='trigram');
CREATE VIRTUAL TABLE modification_fts USING fts5(search_text_raw,
 content='modification_records',content_rowid='record_no',tokenize='trigram');
