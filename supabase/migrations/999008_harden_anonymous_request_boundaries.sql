-- Keep RPC parameter names stable while qualifying every ambiguous SQL reference.
create or replace function public.check_anon_rate_limit(
  identifier text,
  window_seconds integer,
  max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_identifier alias for $1;
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if rate_identifier is null or length(rate_identifier) = 0 then
    raise exception 'identifier is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.anon_rate_limits (identifier, window_start, request_count)
    values (rate_identifier, bucket_start, 1)
  on conflict on constraint anon_rate_limits_pkey
    do update set request_count = public.anon_rate_limits.request_count + 1
    returning public.anon_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  delete from public.anon_rate_limits as expired
   where expired.identifier = rate_identifier
     and expired.window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$$;

-- Pointer validation is called by SECURITY DEFINER integrity triggers only.
revoke all on function public.validate_chat_turn_message_pointer(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
