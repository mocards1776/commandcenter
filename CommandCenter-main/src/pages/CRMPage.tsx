import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { crmApi } from "@/lib/api";
import { Users, Plus, Phone, Mail, Building2, Clock, AlertTriangle, CheckCircle, X, Loader2 } from "lucide-react";
import { cn, relativeDate } from "@/lib/utils";
import type { CRMPerson } from "@/types";
import toast from "react-hot-toast";

function PersonCard({ person }: { person: CRMPerson }) {
  const qc = useQueryClient();

  const contactMutation = useMutation({
    mutationFn: () => crmApi.markContacted(person.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm"] });
      toast.success(`Marked ${person.name} as contacted!`);
    },
  });

  const initials = person.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-indigo-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500"];
  const colorIdx = person.name.charCodeAt(0) % colors.length;

  return (
    <div className={cn(
      "rounded-2xl border p-4 transition-all group",
      person.overdue_contact
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-[#2a2a45] bg-[#12121f] hover:border-[#3d3d6b]"
    )}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0", colors[colorIdx])}>
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-white">{person.name}</h3>
            {person.relationship_type && (
              <span className="text-xs text-slate-500 bg-[#1a1a2e] px-2 py-0.5 rounded-full">{person.relationship_type}</span>
            )}
            {person.overdue_contact && (
              <span className="flex items-center gap-1 text-xs text-amber-400 font-semibold">
                <AlertTriangle className="w-3 h-3" /> Overdue
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mt-1.5">
            {person.company && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Building2 className="w-3 h-3" /> {person.company}
              </span>
            )}
            {person.email && (
              <a href={`mailto:${person.email}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-400 transition-colors">
                <Mail className="w-3 h-3" /> {person.email}
              </a>
            )}
            {person.phone && (
              <a href={`tel:${person.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-400 transition-colors">
                <Phone className="w-3 h-3" /> {person.phone}
              </a>
            )}
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <Clock className="w-3 h-3" />
              {person.last_contact_date
                ? `Last: ${person.days_since_contact}d ago`
                : "Never contacted"}
              {person.contact_frequency_days && ` · Target: every ${person.contact_frequency_days}d`}
            </span>
            <button
              onClick={() => contactMutation.mutate()}
              disabled={contactMutation.isPending}
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-all disabled:opacity-30"
            >
              <CheckCircle className="w-3 h-3" /> Contacted
            </button>
          </div>

          {person.notes_text && (
            <p className="mt-2 text-xs text-slate-500 line-clamp-2">{person.notes_text}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NewPersonForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [freq, setFreq] = useState("");
  const [relType, setRelType] = useState("");
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => crmApi.create({
      name, email: email || undefined, phone: phone || undefined,
      company: company || undefined,
      contact_frequency_days: freq ? parseInt(freq) : undefined,
      relationship_type: relType || undefined,
      tag_ids: [],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm"] });
      toast.success("Person added!");
      onClose();
    },
  });

  return (
    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sky-300">Add Person</h3>
        <button onClick={onClose}><X className="w-4 h-4 text-slate-500" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name *" autoFocus
          className="col-span-2 bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-sky-500/40" />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
          className="bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone"
          className="bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
        <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company"
          className="bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
        <input value={relType} onChange={e => setRelType(e.target.value)} placeholder="Relationship type"
          className="bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
        <input value={freq} onChange={e => setFreq(e.target.value)} placeholder="Contact every N days" type="number"
          className="col-span-2 bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
      </div>
      <button
        onClick={() => name.trim() && createMutation.mutate()}
        disabled={!name.trim() || createMutation.isPending}
        className="w-full py-2 rounded-xl bg-sky-500 text-white font-semibold text-sm hover:bg-sky-600 disabled:opacity-50 transition-colors"
      >
        Add Person
      </button>
    </div>
  );
}

export function CRMPage() {
  const [showNew, setShowNew] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");

  const { data: people, isLoading } = useQuery({
    queryKey: ["crm"],
    queryFn: () => crmApi.list(),
  });

  const filtered = people?.filter(p => {
    if (overdueOnly && !p.overdue_contact) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const overdue = people?.filter(p => p.overdue_contact).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-orange-400" />
            People CRM
          </h1>
          {overdue > 0 && (
            <p className="text-sm text-amber-400 mt-0.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {overdue} contact{overdue > 1 ? "s" : ""} overdue
            </p>
          )}
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" /> Add Person
        </button>
      </div>

      <div className="flex gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…"
          className="flex-1 bg-[#12121f] border border-[#2a2a45] rounded-xl px-4 py-2 text-sm text-slate-300 placeholder:text-slate-600 outline-none" />
        <button
          onClick={() => setOverdueOnly(!overdueOnly)}
          className={cn("px-3 py-2 rounded-xl border text-sm font-medium transition-all",
            overdueOnly ? "border-amber-500/40 bg-amber-500/20 text-amber-300" : "border-[#2a2a45] text-slate-500 hover:text-slate-300")}
        >
          Overdue only
        </button>
      </div>

      {showNew && <NewPersonForm onClose={() => setShowNew(false)} />}

      {isLoading
        ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-orange-400" /></div>
        : (
          <div className="space-y-3">
            {filtered?.map(p => <PersonCard key={p.id} person={p} />)}
            {filtered?.length === 0 && (
              <div className="text-center py-12 text-slate-600">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>{search || overdueOnly ? "No matches." : "No people yet. Add someone!"}</p>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
