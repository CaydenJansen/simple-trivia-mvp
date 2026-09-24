"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type UserRow = Database["public"]["Functions"]["admin_list_users"]["Returns"][number];
type Role = "host" | "admin" | "super_admin";
const roleName = (role: string) => role === "super_admin" ? "Super-admin" : role === "admin" ? "Admin" : "Host";

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [role, setRole] = useState<Role>("host");
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const result = await supabase.rpc("admin_list_users", { p_search: search, p_offset: page * 25 });
      if (!active) return;
      if (result.error) {
        setRows([]);
        setError("Could not load users. Refresh and check your super-admin access.");
      } else setRows(result.data ?? []);
      setLoading(false);
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, page, refresh]);

  async function saveAccess() {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await supabase.rpc("admin_set_user_role", { p_user_id: selected.user_id, p_role: role, p_expected_role: selected.role });
      if (result.error) { setError(result.error.message); return; }
      setNotice(`${selected.email}: access changed to ${roleName(role)}.`);
      setSelected(null);
      setRefresh(value => value + 1);
    } catch { setError("Could not save access. Please retry."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <section className="mt-7 space-y-5">
    <div><h2 className="text-2xl font-bold">Users & access</h2><p className="mt-2 text-sm text-zinc-600">Admins manage the Question Library and review suggestions. Super-admins can also manage access. People must create an account before you can grant access.</p></div>
    <input aria-label="Search users" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Search by email or name…" className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 sm:max-w-lg" />
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {error && !selected && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {loading ? <p>Loading users…</p> : <div className="space-y-3">
      {rows.map(user => <article key={user.user_id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="min-w-0"><h3 className="break-all font-bold">{user.email}</h3>{user.display_name && <p className="text-sm text-zinc-600">{user.display_name}</p>}<p className="mt-1 text-xs text-zinc-500">{roleName(user.role)} · {user.quiz_count} quizzes · Joined {new Date(user.created_at).toLocaleDateString()}</p></div>
        <button type="button" disabled={user.is_self} onClick={() => { setSelected(user); setRole(user.role as Role); setError(null); }} className="rounded-xl bg-violet-50 px-4 py-2 font-semibold text-violet-700 disabled:opacity-50">{user.is_self ? "Your account" : "Manage access"}</button>
      </article>)}
      {!rows.length && <p>No users found.</p>}
    </div>}
    <div className="flex items-center gap-4"><button disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><span className="text-sm">Page {page + 1}{rows[0] ? ` · ${rows[0].total_count} users` : ""}</span><button disabled={loading || !rows[0] || (page + 1) * 25 >= rows[0].total_count} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></div>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-5"><section role="dialog" aria-modal="true" aria-labelledby="access-title" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
      <h2 id="access-title" className="text-xl font-bold">Manage access</h2><p className="break-all">{selected.email}</p>
      <label className="block font-semibold">Account role<select autoFocus value={role} onChange={event => setRole(event.target.value as Role)} disabled={saving} className="mt-2 block w-full rounded-xl border p-3"><option value="host">Host — no admin access</option><option value="admin">Admin — library & analytics</option><option value="super_admin">Super-admin — includes managing access</option></select></label>
      <p className="text-sm text-zinc-600">This changes their access immediately. Grant super-admin access only to people trusted to manage other administrators. Your own access cannot be changed here.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3"><button disabled={saving} onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2">Cancel</button><button disabled={saving || role === selected.role} onClick={() => void saveAccess()} className="rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : "Save access"}</button></div>
    </section></div>}
  </section>;
}
