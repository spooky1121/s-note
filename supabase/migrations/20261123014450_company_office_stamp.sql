-- Keep the round corporate seal and square office stamp as separate private assets.
-- Existing company/owner read permissions and branding Storage policies remain intact.
begin;

alter table public.zc_media
  drop constraint if exists zc_media_group_name_check,
  add constraint zc_media_group_name_check check (
    group_name in ('photos', 'registration', 'inspection1', 'inspection2',
                   'modelPhoto', 'companyStamp', 'companyLogo', 'companyOfficeStamp')
  );

alter table public.zc_media
  drop constraint if exists snote_company_brand_media_check,
  add constraint snote_company_brand_media_check check (
    group_name not in ('companyStamp', 'companyLogo', 'companyOfficeStamp') or (
      car_id = 'company-brand'
      and file_size between 1 and 3145728
      and mime_type in ('image/png', 'image/jpeg', 'image/webp')
      and id <> '' and pg_catalog.strpos(id, '/') = 0
      and file_path = company_id::text || '/' || owner_id::text || '/branding/' || id ||
        case mime_type
          when 'image/png' then '.png'
          when 'image/jpeg' then '.jpg'
          when 'image/webp' then '.webp'
        end
    )
  );

drop policy if exists snote_brand_media_insert_guard on public.zc_media;
create policy snote_brand_media_insert_guard on public.zc_media
  as restrictive for insert to authenticated
  with check (
    group_name not in ('companyStamp', 'companyLogo', 'companyOfficeStamp') or (
      owner_id = (select auth.uid())
      and exists (
        select 1 from public.zc_members as member
        where member.user_id = (select auth.uid())
          and member.company_id = zc_media.company_id
          and member.active is true and member.role = 'admin'
      )
    )
  );

drop policy if exists snote_brand_media_delete_guard on public.zc_media;
create policy snote_brand_media_delete_guard on public.zc_media
  as restrictive for delete to authenticated
  using (
    group_name not in ('companyStamp', 'companyLogo', 'companyOfficeStamp') or exists (
      select 1 from public.zc_members as member
      where member.user_id = (select auth.uid())
        and member.company_id = zc_media.company_id
        and member.active is true and member.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
commit;
