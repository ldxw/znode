import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Award, Check, KeyRound, Loader2, Sparkles } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface Level {
  id: string;
  name: string;
  description: string;
  order: number;
  isDefault: boolean;
  perks: string[];
}

interface LevelsResponse {
  myLevelId: string | null;
  levels: Level[];
}

const MyLevel = () => {
  const { toast } = useToast();
  const { t: tr } = useLanguage();
  const lt = (tr as any)?.levels || {};
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["my-level"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/levels`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load levels");
      return r.json() as Promise<LevelsResponse>;
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async (value: string) => {
      const r = await fetch(`${API_URL}/api/levels/redeem`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ code: value.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to redeem code");
      return d;
    },
    onSuccess: (d: any) => {
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["my-level"] });
      queryClient.invalidateQueries({ queryKey: ["hosting-plans"] });
      toast({
        title: lt.redeemed || "Level upgraded",
        description: d?.level?.name || "",
      });
    },
    onError: (e: Error) =>
      toast({ title: lt.redeemFailed || "Redemption failed", description: e.message, variant: "destructive" }),
  });

  const levels = data?.levels || [];
  const myLevel = levels.find((l) => l.id === data?.myLevelId) || null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{lt.title || "My Level"}</h1>
          <p className="text-muted-foreground mt-1">
            {lt.subtitle || "Your level decides which hosting plans and hosting accounts you can use."}
          </p>
        </div>

        {/* 当前等级 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Award className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{lt.currentLevel || "Current level"}</p>
                <p className="text-xl font-semibold">
                  {isLoading ? "…" : myLevel?.name || lt.noLevel || "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 兑换激活码 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="w-4 h-4" />
              {lt.redeemTitle || "Redeem an activation code"}
            </CardTitle>
            <CardDescription>
              {lt.redeemDesc || "Enter your activation code to upgrade to the matching level."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={lt.codePlaceholder || "XXXX-XXXX-XXXX"}
                className="max-w-sm font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim()) redeemMutation.mutate(code);
                }}
              />
              <Button
                onClick={() => redeemMutation.mutate(code)}
                disabled={redeemMutation.isPending || !code.trim()}
              >
                {redeemMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {lt.redeem || "Redeem"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 等级列表 */}
        {levels.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{lt.allLevels || "All levels"}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {levels.map((l) => {
                const mine = l.id === data?.myLevelId;
                return (
                  <Card key={l.id} className={mine ? "border-primary ring-1 ring-primary/30" : ""}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-lg">{l.name}</CardTitle>
                        {mine ? (
                          <Badge className="gap-1">
                            <Sparkles className="w-3 h-3" />
                            {lt.mine || "Current"}
                          </Badge>
                        ) : null}
                      </div>
                      {l.description && (
                        <CardDescription className="mt-1">{l.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      {l.perks.length > 0 ? (
                        <ul className="space-y-1.5">
                          {l.perks.map((p, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                              <span>{p}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {lt.noPerks || "No perks listed"}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {!isLoading && levels.length === 0 && (
          <Alert>
            <AlertDescription>
              {lt.empty || "No levels have been configured yet."}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </DashboardLayout>
  );
};

export default MyLevel;
