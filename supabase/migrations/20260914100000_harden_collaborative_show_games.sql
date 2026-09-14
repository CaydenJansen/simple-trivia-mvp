begin;

-- The restored bomb uses the join-request token version so a client cannot
-- impersonate another team or trigger the legacy all-pressed shortcut.
revoke execute on function public.press_beat_the_bomb(uuid, uuid) from anon, authenticated;

commit;
