-- An online listing becomes visible only once the private snapshot exists.
-- The validator inserts the listing after decoding the uploaded archive.
create table public.online_files (
    id uuid primary key,
    owner_id uuid references auth.users (id) on delete cascade,
    snapshot_id uuid not null unique references storage.objects (id) on delete cascade,
    published_link_fingerprint text check (published_link_fingerprint ~ '^[0-9a-f]{64}$'),
    name text not null check (char_length(name) <= 256),
    published_without_key boolean not null default true check (owner_id is not null or not published_without_key),
    document_updated_at timestamptz,
    created_at timestamptz not null default now()
);

create index online_files_owner_id_idx on public.online_files (owner_id);

alter table public.online_files enable row level security;

revoke all on public.online_files from public, anon, authenticated;
grant select, update (name) on public.online_files to authenticated;
grant select, insert, update, delete on public.online_files to service_role;

create policy "Owners see their online files" on public.online_files
    for select to authenticated
    using (owner_id = (select auth.uid()));

create policy "Owners rename their online files" on public.online_files
    for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

-- Match the server's rename operation even for direct Data API callers.
create function public.clean_online_file_rename() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    new.name := left(regexp_replace(
        btrim(new.name, U&'\0009\000a\000b\000c\000d\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000'),
        U&'[[:cntrl:]\061c\200e\200f\202a-\202e\2066-\2069]', '', 'g'
    ), 256);
    if new.name = '' then
        raise exception 'give the file a name' using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke all on function public.clean_online_file_rename() from public, anon, authenticated;

create trigger clean_online_file_rename before update of name on public.online_files
    for each row execute function public.clean_online_file_rename();

-- Snapshots are immutable. Deleting one through the Storage API also removes
-- its listing in the same metadata transaction via the foreign key above.
create policy "Owners upload private Figcraft snapshots" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'figcraft-files'
        and owner_id = (select auth.uid())::text
        and name ~ ('^' || (select auth.uid())::text ||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]figcraft$')
    );

create policy "Owners remove private Figcraft snapshots" on storage.objects
    for delete to authenticated
    using (bucket_id = 'figcraft-files' and owner_id = (select auth.uid())::text);
