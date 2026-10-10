import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Award, Check, Loader2, Pencil, Plus, Power, Trash2, Users } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface Level {
  id: string;
  name: string;
  description: string;
  order: number;
  isDefault: boolean;
  isActive: boolean;
  perks: string[];
  memberCount?: number;
}

const emptyForm = () => ({
  id: "",
  name: "",
  description: "",
  order: 0,
  isDefault: false,
  isActive: true,
  perksText: "",
});
type LevelForm = ReturnType<typeof emptyForm>;

const UserLevelsSettings = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const lt = (t as any)?.admin?.levels || {};
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<LevelForm>(emptyForm());

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-levels"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/levels/admin`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load levels");
      return r.json() as Promise<{ levels: Level[] }>;
    },
  });
  const levels: Level[] = data?.levels || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-levels"] });
    queryClient.invalidateQueries({ queryKey: ["hosting-plans-admin"] });
    queryClient.invalidateQueries({ queryKey: ["admin-activation-codes"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (f: LevelForm) => {
      const payload = {
        name: f.name,
        description: f.description,
        order: Number(f.order) || 0,
        isDefault: f.isDefault,
        isActive: f.isActive,
        perks: f.perksText.split("\n").map((x) => x.trim()).filter(Boolean),
      };
      const r = await fetch(f.id ? `${API_URL}/api/levels/${f.id}` : `${API_URL}/api/levels`, {
        method: f.id ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to save level");
      return d;
    },
    onSuccess: () => {
      setDialogOpen(false);
      invalidate();
      toast({ title: lt.saved || "Saved", description: lt.savedDesc || "Level saved" });
    },
    onError: (e: Error) => toast({ title: lt.error || "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await fetch(`${API_URL}/api/levels/${id}/toggle`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ isActive }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to toggle level");
      return d;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: lt.error || "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`${API_URL}/api/levels/${id}`, { method: "DELETE", headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to delete level");
      return d;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: lt.deleted || "Deleted", description: lt.deletedDesc || "Level deleted" });
    },
    onError: (e: Error) => toast({ title: lt.error || "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    const f = emptyForm();
    f.order = levels.length;
    setForm(f);
    setDialogOpen(true);
  };

  const openEdit = (l: Level) => {
    setForm({
      id: l.id,
      name: l.name,
      description: l.description || "",
      order: l.order,
      isDefault: l.isDefault,
      isActive: l.isActive,
      perksText: (l.perks || []).join("\n"),
    });
    setDialogOpen(true);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{lt.title || "User Levels"}</h1>
            <p className="text-muted-foreground mt-1">
              {lt.subtitle || "Levels decide which hosting plans and hosting accounts each user can use."}
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            {lt.addLevel || "New Level"}
          </Button>
        </div>

        <Alert>
          <Award className="h-4 w-4" />
          <AlertTitle>{lt.howItWorks || "How it works"}</AlertTitle>
          <AlertDescription>
            {lt.howItWorksDesc ||
              "Users upgrade to a level by redeeming an activation code. Then set which plans and hosting accounts each level may use."}
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : levels.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Award className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{lt.noLevels || "No levels yet"}</p>
              <p className="text-sm mt-1">{lt.noLevelsHint || "Create a level and an activation code to hand out"}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {levels.map((l) => (
              <Card key={l.id} className={l.isActive ? "" : "opacity-60"}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {l.name}
                      {l.isDefault && <Badge variant="secondary">{lt.default || "Default"}</Badge>}
                    </CardTitle>
                    <Badge variant={l.isActive ? "default" : "secondary"}>
                      {l.isActive ? lt.active || "Active" : lt.inactive || "Disabled"}
                    </Badge>
                  </div>
                  {l.description && <CardDescription className="mt-1">{l.description}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {l.perks?.length > 0 && (
                    <ul className="space-y-1">
                      {l.perks.map((p, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {l.memberCount ?? 0}
                    </span>
                    <span>{lt.orderLabel || "Order"}: {l.order}</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => openEdit(l)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      {lt.edit || "Edit"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={l.isDefault || toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate({ id: l.id, isActive: !l.isActive })}
                    >
                      <Power className="w-3.5 h-3.5 mr-1" />
                      {l.isActive ? lt.disable || "Disable" : lt.enable || "Enable"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive ml-auto" disabled={l.isDefault}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{lt.confirmDelete || "Delete this level?"}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {lt.confirmDeleteDesc ||
                              "Users on this level fall back to the default level, and its activation codes are deleted."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{lt.cancel || "Cancel"}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(l.id)}>
                            {lt.delete || "Delete"}
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

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{form.id ? lt.editLevel || "Edit Level" : lt.addLevel || "New Level"}</DialogTitle>
              <DialogDescription>
                {lt.dialogDesc || "Give the level a name and describe what it unlocks."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="lv-name">{lt.name || "Level name"}</Label>
                  <Input
                    id="lv-name"
                    placeholder={lt.namePlaceholder || "e.g. VIP"}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lv-order">{lt.orderLabel || "Order"}</Label>
                  <Input
                    id="lv-order"
                    type="number"
                    value={form.order}
                    onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {lt.orderHint || "Higher = higher level. Users cannot redeem a code for a lower level."}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lv-desc">{lt.description || "Description"}</Label>
                <Input
                  id="lv-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lv-perks">{lt.perks || "Perks (one per line)"}</Label>
                <Textarea
                  id="lv-perks"
                  rows={4}
                  placeholder={lt.perksPlaceholder || "More hosting plans\nPriority support"}
                  value={form.perksText}
                  onChange={(e) => setForm({ ...form, perksText: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="lv-default"
                    checked={form.isDefault}
                    onCheckedChange={(v) => setForm({ ...form, isDefault: v })}
                  />
                  <Label htmlFor="lv-default">{lt.default || "Default"}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="lv-active"
                    checked={form.isActive}
                    onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  />
                  <Label htmlFor="lv-active">{lt.active || "Active"}</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {lt.cancel || "Cancel"}
              </Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending || !form.name.trim()}
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {lt.save || "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
};

export default UserLevelsSettings;
