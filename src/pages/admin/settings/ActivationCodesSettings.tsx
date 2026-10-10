import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, Copy, KeyRound, Loader2, Plus, Power, Trash2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface Code {
  id: string;
  code: string;
  levelId: string;
  levelName: string;
  maxUses: number | null;
  usedCount: number;
  remaining: number | null;
  expiresAt: string | null;
  expired: boolean;
  isActive: boolean;
  note: string;
  createdAt: string;
}

interface LevelOption {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
}

const emptyForm = () => ({
  levelId: "",
  code: "",
  count: 1,
  prefix: "",
  maxUses: "",
  expiresAt: "",
  note: "",
  isActive: true,
});
type CodeForm = ReturnType<typeof emptyForm>;

const ActivationCodesSettings = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const ct = (t as any)?.admin?.activationCodes || {};
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CodeForm>(emptyForm());
  const [copied, setCopied] = useState<string>("");
  const [usesFor, setUsesFor] = useState<Code | null>(null);

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-activation-codes"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/activation-codes/admin`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load codes");
      return r.json() as Promise<{ codes: Code[]; levels: LevelOption[] }>;
    },
  });
  const codes: Code[] = data?.codes || [];
  const levels: LevelOption[] = data?.levels || [];

  const { data: usesData } = useQuery({
    queryKey: ["code-uses", usesFor?.id],
    enabled: !!usesFor,
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/activation-codes/${usesFor!.id}/uses`, { headers: authHeaders() });
      if (!r.ok) return { uses: [] as Array<{ id: string; userEmail: string; usedAt: string }> };
      return r.json() as Promise<{ uses: Array<{ id: string; userEmail: string; usedAt: string }> }>;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-activation-codes"] });

  const createMutation = useMutation({
    mutationFn: async (f: CodeForm) => {
      const payload = {
        levelId: f.levelId,
        code: f.code.trim() || undefined,
        count: Number(f.count) || 1,
        prefix: f.prefix.trim() || undefined,
        maxUses: f.maxUses === "" ? null : Number(f.maxUses),
        expiresAt: f.expiresAt || null,
        note: f.note || undefined,
        isActive: f.isActive,
      };
      const r = await fetch(`${API_URL}/api/activation-codes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to create codes");
      return d;
    },
    onSuccess: (d: any) => {
      setDialogOpen(false);
      invalidate();
      toast({ title: ct.created || "Created", description: `${d?.codes?.length ?? 0}` });
    },
    onError: (e: Error) => toast({ title: ct.error || "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await fetch(`${API_URL}/api/activation-codes/${id}/toggle`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error("Failed to toggle code");
      return r.json();
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: ct.error || "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`${API_URL}/api/activation-codes/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to delete code");
      return r.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: ct.deleted || "Deleted" });
    },
    onError: (e: Error) => toast({ title: ct.error || "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    const f = emptyForm();
    f.levelId = levels[0]?.id || "";
    setForm(f);
    setDialogOpen(true);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{ct.title || "Activation Codes"}</h1>
            <p className="text-muted-foreground mt-1">
              {ct.subtitle || "Hand out codes that upgrade a user to a level."}
            </p>
          </div>
          <Button onClick={openCreate} disabled={levels.length === 0}>
            <Plus className="w-4 h-4 mr-2" />
            {ct.addCode || "New Code"}
          </Button>
        </div>

        {levels.length === 0 && (
          <Alert>
            <KeyRound className="h-4 w-4" />
            <AlertTitle>{ct.needLevel || "Create a user level first"}</AlertTitle>
            <AlertDescription>
              {ct.needLevelDesc || "Activation codes upgrade users to a level, so you need at least one level."}
            </AlertDescription>
          </Alert>
        )}

        {levels.length > 0 && (
          <Alert>
            <KeyRound className="h-4 w-4" />
            <AlertTitle>{ct.howItWorks || "How it works"}</AlertTitle>
            <AlertDescription>
              {ct.howItWorksDesc || "Users enter the code on their “My Level” page and are upgraded instantly."}
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : codes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{ct.noCodes || "No activation codes yet"}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {codes.map((c) => (
              <Card key={c.id} className={c.isActive && !c.expired ? "" : "opacity-60"}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => copy(c.code)}
                      className="font-mono text-sm bg-muted rounded px-2 py-1 inline-flex items-center gap-2 hover:bg-muted/70"
                      title={ct.copy || "Copy"}
                    >
                      {c.code}
                      {copied === c.code ? (
                        <Check className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>

                    <Badge variant="outline">{c.levelName || "—"}</Badge>

                    <span className="text-xs text-muted-foreground">
                      {ct.usage || "Used"}: {c.usedCount}
                      {c.maxUses != null ? ` / ${c.maxUses}` : " / ∞"}
                    </span>

                    {c.expiresAt && (
                      <span className="text-xs text-muted-foreground">
                        {ct.expires || "Expires"}: {new Date(c.expiresAt).toLocaleDateString()}
                      </span>
                    )}

                    {c.expired && <Badge variant="destructive">{ct.expiredLabel || "Expired"}</Badge>}
                    {!c.isActive && <Badge variant="secondary">{ct.disabled || "Disabled"}</Badge>}

                    {c.note && <span className="text-xs text-muted-foreground">· {c.note}</span>}

                    <div className="flex items-center gap-2 ml-auto">
                      <Button variant="ghost" size="sm" onClick={() => setUsesFor(c)}>
                        {ct.viewUses || "Uses"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate({ id: c.id, isActive: !c.isActive })}
                      >
                        <Power className="w-3.5 h-3.5 mr-1" />
                        {c.isActive ? ct.disable || "Disable" : ct.enable || "Enable"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{ct.confirmDelete || "Delete this code?"}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {ct.confirmDeleteDesc ||
                                "Users who already redeemed it keep their level. This only removes the code."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{ct.cancel || "Cancel"}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(c.id)}>
                              {ct.delete || "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* 新建 */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{ct.addCode || "New Activation Code"}</DialogTitle>
              <DialogDescription>
                {ct.dialogDesc || "Pick the level to grant, then generate one or many codes."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="ac-level">{ct.level || "Level"}</Label>
                <select
                  id="ac-level"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.levelId}
                  onChange={(e) => setForm({ ...form, levelId: e.target.value })}
                >
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}{l.isActive ? "" : " (disabled)"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ac-count">{ct.count || "How many"}</Label>
                  <Input
                    id="ac-count"
                    type="number"
                    min={1}
                    max={200}
                    value={form.count}
                    onChange={(e) => setForm({ ...form, count: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ac-prefix">{ct.prefix || "Prefix (optional)"}</Label>
                  <Input
                    id="ac-prefix"
                    placeholder="VIP-"
                    value={form.prefix}
                    onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                  />
                </div>
              </div>

              {form.count === 1 && (
                <div className="space-y-2">
                  <Label htmlFor="ac-code">{ct.customCode || "Custom code (optional)"}</Label>
                  <Input
                    id="ac-code"
                    className="font-mono"
                    placeholder={ct.autoCode || "Leave empty to auto-generate"}
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ac-max">{ct.maxUses || "Max uses (stock)"}</Label>
                  <Input
                    id="ac-max"
                    type="number"
                    placeholder={ct.unlimited || "Unlimited"}
                    value={form.maxUses}
                    onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ac-exp">{ct.expires || "Expires at (optional)"}</Label>
                  <Input
                    id="ac-exp"
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ac-note">{ct.note || "Note (optional)"}</Label>
                <Input
                  id="ac-note"
                  placeholder={ct.notePlaceholder || "e.g. giveaway for the launch event"}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="ac-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
                <Label htmlFor="ac-active">{ct.active || "Active"}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {ct.cancel || "Cancel"}
              </Button>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.levelId}
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {ct.generate || "Generate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 使用记录 */}
        <Dialog open={!!usesFor} onOpenChange={(o) => !o && setUsesFor(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{ct.usesTitle || "Code usage"}</DialogTitle>
              <DialogDescription className="font-mono">{usesFor?.code}</DialogDescription>
            </DialogHeader>
            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {(usesData?.uses || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{ct.noUses || "Not used yet."}</p>
              ) : (
                (usesData?.uses || []).map((u) => (
                  <div key={u.id} className="flex items-center justify-between text-sm border-b pb-1.5">
                    <span>{u.userEmail || u.id}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(u.usedAt).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
};

export default ActivationCodesSettings;
