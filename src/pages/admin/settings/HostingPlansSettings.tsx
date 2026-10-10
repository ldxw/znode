import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Star,
  HardDrive,
  Gauge,
  Globe,
  Database,
  Mail,
  Layers,
  Package,
  Power,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import AdminLayout from "@/components/admin/AdminLayout";
import { useLanguage } from "@/contexts/LanguageContext";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface PlanSpecs {
  disk?: string;
  bandwidth?: string;
  domains?: number | string;
  databases?: number | string;
  emailAccounts?: number | string;
  subdomains?: number | string;
}

interface HostingPlan {
  id: string;
  name: string;
  description: string;
  mofhAccountId: string;
  mofhAccountName: string;
  mofhPackage: string;
  specs: PlanSpecs;
  features: string[];
  maxAccounts: number | null;
  used: number;
  remaining: number | null;
  isActive: boolean;
  isFeatured: boolean;
  order: number;
}

interface AccountOption {
  id: string;
  name: string;
  enabled: boolean;
}

const emptyForm = () => ({
  id: "",
  name: "",
  description: "",
  mofhAccountId: "",
  mofhPackage: "",
  disk: "",
  bandwidth: "",
  domains: "",
  databases: "",
  emailAccounts: "",
  subdomains: "",
  featuresText: "",
  maxAccounts: "",
  isActive: true,
  isFeatured: false,
  order: 0,
});

type PlanForm = ReturnType<typeof emptyForm>;

const HostingPlansSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const pt = t.admin?.plans || ({} as any);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(emptyForm());

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["hosting-plans-admin"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/hosting-plans/admin`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load plans");
      return r.json() as Promise<{ plans: HostingPlan[]; accounts: AccountOption[] }>;
    },
  });

  const plans: HostingPlan[] = data?.plans || [];
  const accounts: AccountOption[] = data?.accounts || [];

  // 选中账号下的 MOFH 套餐列表（用来选 mofhPackage）
  const { data: pkgData } = useQuery({
    queryKey: ["mofh-packages", form.mofhAccountId],
    enabled: dialogOpen,
    queryFn: async () => {
      const qs = form.mofhAccountId ? `?accountId=${encodeURIComponent(form.mofhAccountId)}` : "";
      const r = await fetch(`${API_URL}/api/settings/mofh/packages${qs}`, { headers: authHeaders() });
      if (!r.ok) return { packages: [] as Array<{ name: string }> };
      return r.json() as Promise<{ packages: Array<{ name: string }> }>;
    },
  });
  const packages = pkgData?.packages || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["hosting-plans-admin"] });
    queryClient.invalidateQueries({ queryKey: ["hosting-plans"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (f: PlanForm) => {
      const payload = {
        name: f.name,
        description: f.description,
        mofhAccountId: f.mofhAccountId || "",
        mofhPackage: f.mofhPackage,
        specs: {
          disk: f.disk || undefined,
          bandwidth: f.bandwidth || undefined,
          domains: f.domains === "" ? undefined : Number(f.domains),
          databases: f.databases === "" ? undefined : Number(f.databases),
          emailAccounts: f.emailAccounts === "" ? undefined : Number(f.emailAccounts),
          subdomains: f.subdomains === "" ? undefined : Number(f.subdomains),
        },
        features: f.featuresText
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
        maxAccounts: f.maxAccounts === "" ? null : Number(f.maxAccounts),
        isActive: f.isActive,
        isFeatured: f.isFeatured,
        order: Number(f.order) || 0,
      };
      const r = await fetch(
        f.id ? `${API_URL}/api/hosting-plans/${f.id}` : `${API_URL}/api/hosting-plans`,
        { method: f.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(payload) },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to save plan");
      return d;
    },
    onSuccess: () => {
      setDialogOpen(false);
      invalidate();
      toast({ title: pt.saved || "Saved", description: pt.savedDesc || "Plan saved" });
    },
    onError: (e: Error) => toast({ title: pt.error || "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await fetch(`${API_URL}/api/hosting-plans/${id}/toggle`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error("Failed to toggle plan");
      return r.json();
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: pt.error || "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`${API_URL}/api/hosting-plans/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to delete plan");
      return d;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: pt.deleted || "Deleted", description: pt.deletedDesc || "Plan deleted" });
    },
    onError: (e: Error) => toast({ title: pt.error || "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    const base = emptyForm();
    base.order = plans.length;
    setForm(base);
    setDialogOpen(true);
  };

  const openEdit = (p: HostingPlan) => {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description || "",
      mofhAccountId: p.mofhAccountId || "",
      mofhPackage: p.mofhPackage || "",
      disk: p.specs?.disk != null ? String(p.specs.disk) : "",
      bandwidth: p.specs?.bandwidth != null ? String(p.specs.bandwidth) : "",
      domains: p.specs?.domains != null ? String(p.specs.domains) : "",
      databases: p.specs?.databases != null ? String(p.specs.databases) : "",
      emailAccounts: p.specs?.emailAccounts != null ? String(p.specs.emailAccounts) : "",
      subdomains: p.specs?.subdomains != null ? String(p.specs.subdomains) : "",
      featuresText: (p.features || []).join("\n"),
      maxAccounts: p.maxAccounts != null ? String(p.maxAccounts) : "",
      isActive: p.isActive,
      isFeatured: p.isFeatured,
      order: p.order,
    });
    setDialogOpen(true);
  };

  const specChips = (p: HostingPlan) => {
    const s = p.specs || {};
    const chips: Array<{ icon: any; label: string }> = [];
    if (s.disk) chips.push({ icon: HardDrive, label: `${pt.disk || "Disk"}: ${s.disk}` });
    if (s.bandwidth) chips.push({ icon: Gauge, label: `${pt.bandwidth || "Bandwidth"}: ${s.bandwidth}` });
    if (s.domains != null) chips.push({ icon: Globe, label: `${pt.domains || "Domains"}: ${s.domains}` });
    if (s.databases != null) chips.push({ icon: Database, label: `${pt.databases || "Databases"}: ${s.databases}` });
    if (s.emailAccounts != null) chips.push({ icon: Mail, label: `${pt.email || "Email"}: ${s.emailAccounts}` });
    if (s.subdomains != null) chips.push({ icon: Layers, label: `${pt.subdomains || "Subdomains"}: ${s.subdomains}` });
    return chips;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{pt.title || 'Hosting Plans'}</h1>
            <p className="text-muted-foreground mt-1">
              {pt.subtitle || 'Each plan is bound to a MOFH package on a specific reseller account. Users pick a plan when signing up.'}
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            {pt.addPlan || 'New Plan'}
          </Button>
        </div>

        <Alert>
          <Package className="h-4 w-4" />
          <AlertTitle>{pt.howItWorks || 'How it works'}</AlertTitle>
          <AlertDescription>
            {pt.howItWorksDesc || 'The plan decides which reseller credentials and which MOFH package are used when creating the account. The specs below are only for display on the signup page.'}
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : plans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{pt.noPlans || 'No plans yet'}</p>
              <p className="text-sm mt-1">{pt.noPlansHint || 'Create your first plan so users can pick one when signing up'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {plans.map((p) => (
              <Card key={p.id} className={p.isActive ? "" : "opacity-60"}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {p.name}
                        {p.isFeatured && (
                          <Badge variant="default" className="gap-1">
                            <Star className="w-3 h-3" />
                            {pt.featured || 'Featured'}
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {p.mofhAccountName || pt.autoAccount || 'Auto-assigned account'}
                        {" · "}
                        <span className="font-mono text-xs">{p.mofhPackage}</span>
                      </CardDescription>
                    </div>
                    <Badge variant={p.isActive ? "default" : "secondary"}>
                      {p.isActive ? pt.active || "Active" : pt.inactive || "Disabled"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {p.description && (
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {specChips(p).map((c, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-xs rounded-md bg-muted px-2 py-1"
                      >
                        <c.icon className="w-3 h-3" />
                        {c.label}
                      </span>
                    ))}
                  </div>

                  {p.features.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.features.map((f, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <span>
                      {pt.usage || "Used"}: {p.used}
                      {p.maxAccounts != null ? ` / ${p.maxAccounts}` : ` / ∞`}
                    </span>
                    <span>{pt.orderLabel || "Order"}: {p.order}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      {pt.edit || "Edit"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate({ id: p.id, isActive: !p.isActive })}
                    >
                      <Power className="w-3.5 h-3.5 mr-1" />
                      {p.isActive ? pt.disable || "Disable" : pt.enable || "Enable"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive ml-auto">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{pt.confirmDelete || "Delete this plan?"}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {pt.confirmDeleteDesc || "Existing hostings created with this plan are kept; only the link is removed."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{pt.cancel || "Cancel"}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(p.id)}>
                            {pt.delete || "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* 新建 / 编辑 */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{form.id ? pt.editPlan || "Edit Plan" : pt.addPlan || "New Plan"}</DialogTitle>
              <DialogDescription>
                {pt.dialogDesc || "Bind this plan to a MOFH package on one of your reseller accounts."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="plan-name">{pt.name || "Plan name"}</Label>
                  <Input
                    id="plan-name"
                    placeholder={pt.namePlaceholder || "e.g. Starter 10GB"}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-order">{pt.orderLabel || "Order"}</Label>
                  <Input
                    id="plan-order"
                    type="number"
                    value={form.order}
                    onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="plan-desc">{pt.description || "Description"}</Label>
                <Input
                  id="plan-desc"
                  placeholder={pt.descriptionPlaceholder || "Shown under the plan name on the signup page"}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="plan-account">{pt.account || "MOFH account"}</Label>
                  <select
                    id="plan-account"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.mofhAccountId}
                    onChange={(e) => setForm({ ...form, mofhAccountId: e.target.value, mofhPackage: "" })}
                  >
                    <option value="">{pt.autoAccount || "Auto (by strategy)"}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.enabled ? "" : " (disabled)"}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {pt.accountHint || "Which reseller's credentials are used for this plan"}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-package">{pt.mofhPackage || "MOFH package"}</Label>
                  {packages.length > 0 ? (
                    <select
                      id="plan-package"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.mofhPackage}
                      onChange={(e) => setForm({ ...form, mofhPackage: e.target.value })}
                    >
                      <option value="">{pt.pickPackage || "Select a package"}</option>
                      {packages.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="plan-package"
                      placeholder="10GB"
                      value={form.mofhPackage}
                      onChange={(e) => setForm({ ...form, mofhPackage: e.target.value })}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {pt.mofhPackageHint || "The package name as it exists in the MOFH panel"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{pt.displaySpecs || "Display specs (shown to users)"}</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <Input placeholder={pt.disk || "Disk (10GB)"} value={form.disk} onChange={(e) => setForm({ ...form, disk: e.target.value })} />
                  <Input placeholder={pt.bandwidth || "Bandwidth (100GB)"} value={form.bandwidth} onChange={(e) => setForm({ ...form, bandwidth: e.target.value })} />
                  <Input placeholder={pt.domains || "Domains"} type="number" value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} />
                  <Input placeholder={pt.databases || "Databases"} type="number" value={form.databases} onChange={(e) => setForm({ ...form, databases: e.target.value })} />
                  <Input placeholder={pt.email || "Email accounts"} type="number" value={form.emailAccounts} onChange={(e) => setForm({ ...form, emailAccounts: e.target.value })} />
                  <Input placeholder={pt.subdomains || "Subdomains"} type="number" value={form.subdomains} onChange={(e) => setForm({ ...form, subdomains: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="plan-features">{pt.features || "Features (one per line)"}</Label>
                <Textarea
                  id="plan-features"
                  rows={4}
                  placeholder={"Free SSL\ncPanel\nSoftaculous\nNo ads"}
                  value={form.featuresText}
                  onChange={(e) => setForm({ ...form, featuresText: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="plan-max">{pt.maxAccounts || "Max accounts (stock)"}</Label>
                  <Input
                    id="plan-max"
                    type="number"
                    placeholder={pt.unlimited || "Unlimited"}
                    value={form.maxAccounts}
                    onChange={(e) => setForm({ ...form, maxAccounts: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    id="plan-active"
                    checked={form.isActive}
                    onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  />
                  <Label htmlFor="plan-active">{pt.active || "Active"}</Label>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    id="plan-featured"
                    checked={form.isFeatured}
                    onCheckedChange={(v) => setForm({ ...form, isFeatured: v })}
                  />
                  <Label htmlFor="plan-featured">{pt.featured || "Featured"}</Label>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {pt.cancel || "Cancel"}
              </Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending || !form.name.trim() || !form.mofhPackage.trim()}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                {pt.save || "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
};

export default HostingPlansSettings;
