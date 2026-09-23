-- Uploaded files are private (see internal/storage/storage.go). Columns that
-- held a permanent public URL now hold the object key, and every read mints a
-- link that expires.
--
-- The column names still end in _url. Renaming five columns would touch every
-- query and the API's field names for no change in behaviour; the API still
-- *returns* a URL in these fields — a signed one — so the names stay true at
-- the boundary that matters.
--
-- Only values that end in a key the upload handler could have issued are
-- rewritten. Anything else is left as it is: the server refuses to hand an
-- unrecognised value to a browser (handlers/files.go), so an odd row reads as
-- "no file" rather than being silently destroyed here.
--
-- Idempotent: a bare key has no "://" and is skipped.

UPDATE tenants SET id_proof_url = substring(id_proof_url FROM '/((?:public|tenant)/[0-9a-f]{32}\.(?:jpg|png|webp|pdf))$')
 WHERE id_proof_url ~ '://.*/(public|tenant)/[0-9a-f]{32}\.(jpg|png|webp|pdf)$';

UPDATE tenants SET id_proof_front_url = substring(id_proof_front_url FROM '/((?:public|tenant)/[0-9a-f]{32}\.(?:jpg|png|webp|pdf))$')
 WHERE id_proof_front_url ~ '://.*/(public|tenant)/[0-9a-f]{32}\.(jpg|png|webp|pdf)$';

UPDATE tenants SET id_proof_back_url = substring(id_proof_back_url FROM '/((?:public|tenant)/[0-9a-f]{32}\.(?:jpg|png|webp|pdf))$')
 WHERE id_proof_back_url ~ '://.*/(public|tenant)/[0-9a-f]{32}\.(jpg|png|webp|pdf)$';

UPDATE tenants SET photo_url = substring(photo_url FROM '/((?:public|tenant)/[0-9a-f]{32}\.(?:jpg|png|webp|pdf))$')
 WHERE photo_url ~ '://.*/(public|tenant)/[0-9a-f]{32}\.(jpg|png|webp|pdf)$';

UPDATE payments SET proof_url = substring(proof_url FROM '/((?:public|tenant)/[0-9a-f]{32}\.(?:jpg|png|webp|pdf))$')
 WHERE proof_url ~ '://.*/(public|tenant)/[0-9a-f]{32}\.(jpg|png|webp|pdf)$';
