CREATE TABLE users (id INT, name TEXT);
CREATE VIEW active AS SELECT id FROM users;
CREATE FUNCTION greet(n TEXT) RETURNS TEXT AS $$ SELECT upper(n) $$ LANGUAGE sql;
SELECT greet(name), count(*) FROM users;
