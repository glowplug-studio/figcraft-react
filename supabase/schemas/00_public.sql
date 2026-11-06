-- Local unsaved editing has no application tables. Declare the existing public
-- namespace explicitly: pg-delta refuses empty/comment-only desired schemas.
-- Auth and its managed tables remain owned by Supabase.
create schema if not exists public;
