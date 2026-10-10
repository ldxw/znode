import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search,
  Check,
  X,
  Loader2,
  Globe,
  ArrowRight,
  AlertTriangle,
  Server,
  Info,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/contexts/SiteContext";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useTurnstileConfig, isTurnstileRequired } from "@/hooks/useTurnstile";

interface AllowedDomain {
  id: string;
  domain: string;
  /** 该域名归属的 MOFH 账号（空 = 不限） */
  accountId?: string;
}

/** 前台可选的分销账号 */
interface AccountOption {
  id: string;
  name: string;
  cpanelUrl: string;
}

/** 前台可选的建站套餐 */
interface HostingPlanOption {
  id: string;
  name: string;
  description: string;
  mofhAccountId: string;
  mofhAccountName: string;
  mofhPackage: string;
  specs: {
    disk?: string;
    bandwidth?: string;
    domains?: number;
    databases?: number;
    emailAccounts?: number;
    subdomains?: number;
  };
  features: string[];
  isFeatured: boolean;
  remaining: number | null;
}

interface HostingStats {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  limit: number;
  canCreate: boolean;
}

interface CreateHostingResult {
  hosting: {
    username: string;
    domain: string;
  };
}

interface NameserverCheckResult {
  valid: boolean;
  currentNameservers: string[];
  requiredNameservers: string[];
  message: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

const CreateHosting = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  usePageTitle(t.hosting?.createNew || 'Create Hosting');
  
  // Common state
  const [activeTab, setActiveTab] = useState<"subdomain" | "custom">("subdomain");
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<"available" | "taken" | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [label, setLabel] = useState("");

  // 人机验证（Turnstile）：后端对 createHosting 开了校验，这里必须带上 token
  const { data: turnstileConfig } = useTurnstileConfig();
  const requiresTurnstile = isTurnstileRequired(turnstileConfig, 'createHosting');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileKey(prev => prev + 1);
  }, []);
  const handleTurnstileVerify = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  // 子域名注册规则（最小长度 / 禁止前缀），与后端保持一致
  const { data: subdomainRules } = useQuery({
    queryKey: ["subdomain-rules"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/settings/general/public`);
      if (!r.ok) return { minLength: 3, blockedPrefixes: [] as string[] };
      const d = await r.json();
      const min = Number(d.subdomainMinLength);
      return {
        minLength: Number.isFinite(min) && min > 0 ? Math.floor(min) : 3,
        blockedPrefixes: String(d.subdomainBlockedPrefixes || "")
          .split(/[,\n]/)
          .map((p: string) => p.trim().toLowerCase())
          .filter(Boolean),
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Subdomain state
  const [subdomain, setSubdomain] = useState("");

  // ⚠️ 这段校验必须放在 subdomain 声明【之后】：IIFE 会立即执行，
  // 放在前面会访问未初始化的 state，触发 TDZ（ReferenceError: Cannot access 'X' before initialization）导致整页白屏。
  const subdomainRuleError = (() => {
    if (activeTab !== "subdomain") return null;
    const value = subdomain.trim().toLowerCase();
    if (!value) return null;
    const min = subdomainRules?.minLength ?? 3;
    if (value.length < min) {
      return (t.createHosting?.minLengthError || "Subdomain must be at least {n} characters").replace("{n}", String(min));
    }
    const hit = (subdomainRules?.blockedPrefixes || []).find((p: string) => value.startsWith(p));
    if (hit) {
      return t.createHosting?.reservedError || "This subdomain is reserved and cannot be registered";
    }
    return null;
  })();
  const [selectedDomain, setSelectedDomain] = useState("");
  
  // Custom domain state
  const [customDomain, setCustomDomain] = useState("");
  const [nsCheckResult, setNsCheckResult] = useState<NameserverCheckResult | null>(null);
  const [isCheckingNs, setIsCheckingNs] = useState(false);
  const [requiredNameservers, setRequiredNameservers] = useState<string[]>([]);

  // Fetch allowed domains
  const { data: domainsData, isLoading: loadingDomains } = useQuery({
    queryKey: ["allowed-domains-public"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/settings/domains/public`);
      if (!response.ok) throw new Error("Failed to fetch domains");
      return response.json();
    },
  });

  const allDomains: AllowedDomain[] = domainsData?.domains || [];

  // 建站套餐（前台可选）
  const { data: plansData } = useQuery({
    queryKey: ["hosting-plans"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/hosting-plans`);
      if (!response.ok) {
        return { plans: [] as HostingPlanOption[], accounts: [] as AccountOption[] };
      }
      return response.json() as Promise<{ plans: HostingPlanOption[]; accounts: AccountOption[] }>;
    },
    staleTime: 2 * 60 * 1000,
  });
  const plans: HostingPlanOption[] = plansData?.plans || [];
  const accounts: AccountOption[] = plansData?.accounts || [];

  // 用户自己选的分销账号；默认「自动分配」= 不限制。
  // ⚠️ 不要默认选中第一个账号：套餐是绑定到具体账号的，预选会把别家的套餐整段藏掉，
  // 用户只会看到「没有套餐」而不知道原因。
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  useEffect(() => {
    // 账号被删/改了之后，之前的选择失效就退回「自动分配」
    if (selectedAccountId && accounts.length > 0 && !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId("");
    }
  }, [accounts, selectedAccountId]);

  // 只展示当前账号下的套餐（没绑账号的视为通用）
  const plansForAccount: HostingPlanOption[] = selectedAccountId
    ? plans.filter((p) => !p.mofhAccountId || p.mofhAccountId === selectedAccountId)
    : plans;

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const selectedPlan = plansForAccount.find((p) => p.id === selectedPlanId) || null;

  useEffect(() => {
    if (plansForAccount.length > 0 && !plansForAccount.some((p) => p.id === selectedPlanId)) {
      setSelectedPlanId(plansForAccount[0].id);
    }
  }, [plansForAccount, selectedPlanId]);

  // 域名列表收窄到选定的分销商名下（accountId 为空的视为通用）
  const effectiveAccountId = selectedPlan?.mofhAccountId || selectedAccountId || "";
  const domains: AllowedDomain[] = effectiveAccountId
    ? allDomains.filter((d) => !d.accountId || d.accountId === effectiveAccountId)
    : allDomains;

  useEffect(() => {
    if (selectedDomain && !domains.some((d) => d.domain === selectedDomain)) {
      setSelectedDomain(domains[0]?.domain || "");
    }
  }, [domains, selectedDomain]);

  // Fetch hosting stats
  const { data: statsData, isLoading: loadingStats } = useQuery({
    queryKey: ["hosting-stats"],
    queryFn: async () => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_URL}/api/hosting/stats/summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
  });

  const stats: HostingStats = statsData || { total: 0, limit: 3, canCreate: true };

  // Fetch required nameservers
  useQuery({
    queryKey: ["required-nameservers"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/hosting/nameservers`);
      if (!response.ok) throw new Error("Failed to fetch nameservers");
      const data = await response.json();
      setRequiredNameservers(data.nameservers || []);
      return data;
    },
  });

  // Set default domain when loaded
  useEffect(() => {
    if (domains.length > 0 && !selectedDomain) {
      setSelectedDomain(domains[0].domain);
    }
  }, [domains, selectedDomain]);

  // Reset state when switching tabs
  useEffect(() => {
    setCheckResult(null);
    setShowConfig(false);
    setNsCheckResult(null);
  }, [activeTab]);

  // Check domain mutation (for subdomain)
  const checkDomainMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_URL}/api/hosting/check-domain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subdomain,
          domain: selectedDomain,
        }),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setIsChecking(false);
      if (data.available) {
        setCheckResult("available");
        setShowConfig(true);
      } else {
        setCheckResult("taken");
        setShowConfig(false);
      }
    },
    onError: () => {
      setIsChecking(false);
      toast({
        title: t.messages.error,
        description: t.createHosting.cannotCheckDomain,
        variant: "destructive",
      });
    },
  });

  // Check nameservers mutation (for custom domain)
  const checkNameserversMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_URL}/api/hosting/check-nameservers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          domain: customDomain,
        }),
      });
      return response.json();
    },
    onSuccess: (data: NameserverCheckResult) => {
      setIsCheckingNs(false);
      setNsCheckResult(data);
      if (data.valid) {
        setCheckResult("available");
        setShowConfig(true);
      } else {
        setCheckResult("taken");
        setShowConfig(false);
      }
    },
    onError: () => {
      setIsCheckingNs(false);
      toast({
        title: t.messages.error,
        description: t.createHosting?.cannotCheckNameservers || "Cannot check nameservers",
        variant: "destructive",
      });
    },
  });

  // Create hosting mutation
  const createHostingMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("accessToken");
      const isCustom = activeTab === "custom";
      
      const response = await fetch(`${API_URL}/api/hosting/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(isCustom ? {
          customDomain: customDomain,
          isCustomDomain: true,
          label,
          planId: selectedPlanId || undefined,
          accountId: selectedAccountId || undefined,
          turnstileToken: turnstileToken || undefined,
        } : {
          subdomain,
          domain: selectedDomain,
          label,
          planId: selectedPlanId || undefined,
          accountId: selectedAccountId || undefined,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create hosting");
      }
      return data as CreateHostingResult;
    },
    onSuccess: (data) => {
      toast({
        title: t.messages.success,
        description: t.messages.hostingCreated,
      });
      // Navigate directly to hosting details page
      navigate(`/user/hosting/${data.hosting.username}`);
    },
    onError: (error: Error) => {
      toast({
        title: t.messages.error,
        description: error.message,
        variant: "destructive",
      });
    },
    // token 只能用一次，无论成败都要重置，否则重试必然失败
    onSettled: () => resetTurnstile(),
  });

  const handleCheckDomain = () => {
    if (!subdomain.trim() || !selectedDomain) return;
    setIsChecking(true);
    setCheckResult(null);
    checkDomainMutation.mutate();
  };

  const handleCheckNameservers = () => {
    if (!customDomain.trim()) return;
    setIsCheckingNs(true);
    setCheckResult(null);
    setNsCheckResult(null);
    checkNameserversMutation.mutate();
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (subdomainRuleError) {
      toast({
        title: t.messages.error,
        description: subdomainRuleError,
        variant: "destructive",
      });
      return;
    }
    if (requiresTurnstile && !turnstileToken) {
      toast({
        title: t.messages.error,
        description: t.createHosting?.captchaRequired || "Please complete the captcha verification",
        variant: "destructive",
      });
      return;
    }
    createHostingMutation.mutate();
  };

  const getDisplayDomain = () => {
    if (activeTab === "custom") {
      return customDomain;
    }
    return `${subdomain}.${selectedDomain}`;
  };

  // Check if can create
  if (!loadingStats && !stats.canCreate) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t.hosting.createNew}</h1>
            <p className="text-muted-foreground">
              {t.createHosting.chooseSubdomainAndCreate}
            </p>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t.createHosting.limitReached}</AlertTitle>
            <AlertDescription>
              {t.createHosting.maxAccountsUsed.replace('{limit}', stats.limit.toString())}
            </AlertDescription>
          </Alert>

          <Button onClick={() => navigate("/user/hosting")} variant="outline">
            {t.createHosting.backToHostingList}
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  // 按「提供方账号」分组：多分销商时前台分组展示，只有一个账号时平铺
  const planGroups = (() => {
    const map = new Map<string, { key: string; name: string; plans: HostingPlanOption[] }>();
    for (const p of plansForAccount) {
      const key = p.mofhAccountId || "__auto__";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: p.mofhAccountName || (t.createHosting?.autoAccount || "Auto-assigned"),
          plans: [],
        });
      }
      map.get(key)!.plans.push(p);
    }
    return [...map.values()];
  })();

  const renderPlanCard = (p: HostingPlanOption) => {
    const active = selectedPlanId === p.id;
    const chips: string[] = [];
    if (p.specs?.disk) chips.push(`${t.createHosting?.disk || "Disk"}: ${p.specs.disk}`);
    if (p.specs?.bandwidth) chips.push(`${t.createHosting?.bandwidth || "Bandwidth"}: ${p.specs.bandwidth}`);
    if (p.specs?.domains != null) chips.push(`${t.createHosting?.domains || "Domains"}: ${p.specs.domains}`);
    if (p.specs?.databases != null) chips.push(`${t.createHosting?.databases || "Databases"}: ${p.specs.databases}`);
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setSelectedPlanId(p.id)}
        className={`text-left rounded-xl border p-4 transition ${
          active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{p.name}</span>
          {p.isFeatured && (
            <Badge className="text-xs">{t.createHosting?.recommended || "Recommended"}</Badge>
          )}
        </div>
        {p.description && (
          <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {chips.map((c, i) => (
              <span key={i} className="text-xs rounded-md bg-muted px-2 py-0.5">{c}</span>
            ))}
          </div>
        )}
        {p.features.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {p.features.slice(0, 4).map((f, i) => (
              <Badge key={i} variant="outline" className="text-xs font-normal">{f}</Badge>
            ))}
          </div>
        )}
        {p.remaining != null && (
          <p className="text-xs text-muted-foreground mt-2">
            {t.createHosting?.remaining || "Remaining"}: {p.remaining}
          </p>
        )}
      </button>
    );
  };


  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t.hosting.createNew}</h1>
          <p className="text-muted-foreground">
            {t.createHosting.chooseSubdomainAndCreate}
          </p>
        </div>

        {/* Limit notice */}
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
          <p className="text-sm text-foreground">
            <span className="font-medium">{t.hostingList.limit}:</span> {t.hostingList.usingAccounts}{" "}
            <span className="font-bold text-primary">{stats.total}</span>/{stats.limit} {t.hostingList.freeHostingAccounts}.
          </p>
        </div>

        {/* Domain check form */}
        <div className="rounded-2xl bg-card border border-border p-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "subdomain" | "custom")}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="subdomain" className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {t.createHosting?.subdomainTab || "Subdomain"}
              </TabsTrigger>
              <TabsTrigger value="custom" className="flex items-center gap-2">
                <Server className="w-4 h-4" />
                {t.createHosting?.customDomainTab || "Custom Domain"}
              </TabsTrigger>
            </TabsList>

            {/* Subdomain Tab */}
            <TabsContent value="subdomain">
              {loadingDomains ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : domains.length === 0 ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t.createHosting.noDomain}</AlertTitle>
                  <AlertDescription>
                    {t.createHosting.noDomainConfigured}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label>{t.createHosting.subdomain}</Label>
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1">
                        <Input
                          placeholder="mywebsite"
                          value={subdomain}
                          onChange={(e) => {
                            const value = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
                            setSubdomain(value);
                            setCheckResult(null);
                            setShowConfig(false);
                          }}
                          maxLength={8}
                          className="h-12 text-base"
                        />
                      </div>
                      <select
                        value={selectedDomain}
                        onChange={(e) => {
                          setSelectedDomain(e.target.value);
                          setCheckResult(null);
                          setShowConfig(false);
                        }}
                        className="h-12 px-4 rounded-lg border border-input bg-background text-foreground"
                      >
                        {domains.map((d) => (
                          <option key={d.id} value={d.domain}>
                            .{d.domain}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t.createHosting.subdomainHelp}
                    </p>
                    {subdomainRuleError && (
                      <p className="text-sm text-destructive mt-2">{subdomainRuleError}</p>
                    )}
                  </div>

                  <Button
                    onClick={handleCheckDomain}
                    disabled={!subdomain.trim() || !!subdomainRuleError || subdomain.length < 3 || isChecking}
                    size="lg"
                    className="w-full"
                  >
                    {isChecking ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {t.createHosting.checking}
                      </>
                    ) : (
                      <>
                        <Search className="w-5 h-5" />
                        {t.createHosting.checkDomain}
                      </>
                    )}
                  </Button>

                  {/* Check result for subdomain */}
                  {checkResult && activeTab === "subdomain" && (
                    <div
                      className={`p-4 rounded-xl flex items-center gap-3 ${
                        checkResult === "available"
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {checkResult === "available" ? (
                        <>
                          <Check className="w-5 h-5" />
                          <span className="font-medium">
                            {subdomain}.{selectedDomain} {t.createHosting.isAvailable}
                          </span>
                        </>
                      ) : (
                        <>
                          <X className="w-5 h-5" />
                          <span className="font-medium">
                            {subdomain}.{selectedDomain} {t.createHosting.isTaken}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Custom Domain Tab */}
            <TabsContent value="custom">
              <div className="space-y-4">
                {/* Required nameservers info */}
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>{t.createHosting?.requiredNameservers || "Required Nameservers"}</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">{t.createHosting?.nsInstructions || "Point your domain to the following nameservers before registering:"}</p>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1 font-mono text-sm">
                      {requiredNameservers.length > 0 ? (
                        requiredNameservers.map((ns, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Server className="w-3 h-3 text-muted-foreground" />
                            <span>{ns}</span>
                          </div>
                        ))
                      ) : (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                    </div>
                  </AlertDescription>
                </Alert>

                <div>
                  <Label>{t.createHosting?.customDomain || "Custom Domain"}</Label>
                  <Input
                    placeholder="example.com"
                    value={customDomain}
                    onChange={(e) => {
                      setCustomDomain(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""));
                      setCheckResult(null);
                      setShowConfig(false);
                      setNsCheckResult(null);
                    }}
                    className="h-12 text-base mt-2"
                  />
                  <p className="text-sm text-muted-foreground mt-2">
                    {t.createHosting?.customDomainHelp || "Enter your domain name (e.g., example.com or subdomain.example.com)"}
                  </p>
                </div>

                <Button
                  onClick={handleCheckNameservers}
                  disabled={!customDomain.trim() || customDomain.length < 4 || isCheckingNs}
                  size="lg"
                  className="w-full"
                >
                  {isCheckingNs ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t.createHosting?.checkingNameservers || "Checking Nameservers..."}
                    </>
                  ) : (
                    <>
                      <Server className="w-5 h-5" />
                      {t.createHosting?.checkNameservers || "Check Nameservers"}
                    </>
                  )}
                </Button>

                {/* Nameserver check result */}
                {nsCheckResult && (
                  <div
                    className={`p-4 rounded-xl ${
                      nsCheckResult.valid
                        ? "bg-success/10 border border-success/20"
                        : "bg-destructive/10 border border-destructive/20"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      {nsCheckResult.valid ? (
                        <>
                          <Check className="w-5 h-5 text-success" />
                          <span className="font-medium text-success">
                            {t.createHosting?.nsValid || "Nameservers configured correctly!"}
                          </span>
                        </>
                      ) : (
                        <>
                          <X className="w-5 h-5 text-destructive" />
                          <span className="font-medium text-destructive">
                            {t.createHosting?.nsInvalid || "Nameservers not configured correctly"}
                          </span>
                        </>
                      )}
                    </div>
                    
                    {nsCheckResult.currentNameservers && nsCheckResult.currentNameservers.length > 0 && (
                      <div className="text-sm">
                        <p className="text-muted-foreground mb-1">
                          {t.createHosting?.currentNameservers || "Current nameservers:"}
                        </p>
                        <div className="bg-background/50 rounded p-2 font-mono text-xs space-y-1">
                          {nsCheckResult.currentNameservers.map((ns, idx) => (
                            <div key={idx} className={nsCheckResult.valid ? "text-success" : "text-destructive"}>
                              {ns}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {!nsCheckResult.valid && (
                      <p className="text-sm text-muted-foreground mt-3">
                        {t.createHosting?.nsChangeNote || "Please update your domain's nameservers at your registrar and wait for DNS propagation (can take up to 48 hours)."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Account configuration */}
        {showConfig && (
          <div className="rounded-2xl bg-card border border-border p-6 animate-slide-up">
            <h2 className="text-lg font-semibold text-foreground mb-6">
              {t.createHosting.hostingConfig}
            </h2>

            <form onSubmit={handleCreate} className="space-y-6">
              {/* 选择分销账号（多个账号时才出现） */}
              {accounts.length > 1 && (
                <div className="space-y-3">
                  <div>
                    <Label>{t.createHosting?.chooseAccount || "Hosting account"}</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t.createHosting?.chooseAccountHint ||
                        "Pick which of our hosting accounts your hosting is created under."}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSelectedAccountId("")}
                      className={`text-left rounded-xl border p-4 transition ${
                        selectedAccountId === ""
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {t.createHosting?.autoAssign || "Automatic"}
                        </span>
                        {selectedAccountId === "" && <Check className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t.createHosting?.autoAssignHint || "Shows plans from every hosting account"}
                      </p>
                    </button>

                    {accounts.map((a) => {
                      const active = selectedAccountId === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setSelectedAccountId(a.id)}
                          className={`text-left rounded-xl border p-4 transition ${
                            active
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{a.name}</span>
                            {active && <Check className="w-4 h-4 text-primary" />}
                          </div>
                          {a.cpanelUrl && (
                            <p className="text-xs text-muted-foreground mt-1 font-mono">{a.cpanelUrl}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 选了具体账号、但该账号下一个套餐都没有：明确告知，别让人以为功能坏了 */}
              {plans.length > 0 && plansForAccount.length === 0 && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    {t.createHosting?.noPlansForAccount ||
                      "The hosting account you picked has no plans. Switch back to Automatic to see all plans."}
                  </AlertDescription>
                </Alert>
              )}

              {/* 建站套餐选择（按提供方账号分组） */}
              {plansForAccount.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <Label>{t.createHosting?.choosePlan || "Choose a plan"}</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t.createHosting?.choosePlanHint || "Each plan is provided by a specific reseller account."}
                    </p>
                  </div>
                  <div className="space-y-5">
                    {planGroups.map((group) => (
                      <div key={group.key} className="space-y-2">
                        {planGroups.length > 1 && accounts.length <= 1 && (
                          <div className="flex items-center gap-2">
                            <Server className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{group.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {group.plans.length} {t.createHosting?.plansCount || "plans"}
                            </span>
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          {group.plans.map(renderPlanCard)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center gap-3">
                <Globe className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">{t.createHosting.selectedDomain}</p>
                  <p className="font-medium text-foreground">
                    {getDisplayDomain()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfig(false);
                    setCheckResult(null);
                    setNsCheckResult(null);
                  }}
                  className="ml-auto text-sm text-primary hover:underline"
                >
                  {t.createHosting.change}
                </button>
              </div>

              <div>
                <Label htmlFor="label">{t.createHosting.displayName}</Label>
                <Input
                  id="label"
                  placeholder={t.createHosting.displayNamePlaceholder}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="h-12 mt-2"
                />
                <p className="text-sm text-muted-foreground mt-2">
                  {t.createHosting.displayNameHelp}
                </p>
              </div>

              {/* Features included */}
              <div className="border-t border-border pt-6">
                <h3 className="font-medium text-foreground mb-4">
                  {t.createHosting.featuresIncluded}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    "5GB SSD Storage",
                    "Unlimited Bandwidth",
                    "Free SSL",
                    "cPanel Access",
                    "1 MySQL Database",
                    "Softaculous",
                  ].map((feature) => (
                    <div
                      key={feature}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="w-4 h-4 text-success" />
                      {feature}
                    </div>
                  ))}
                </div>
              </div>

              {requiresTurnstile && turnstileConfig?.siteKey && (
                <div className="pb-2">
                  <TurnstileWidget
                    key={`create-${turnstileKey}`}
                    siteKey={turnstileConfig.siteKey}
                    onVerify={handleTurnstileVerify}
                    onExpire={resetTurnstile}
                  />
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={createHostingMutation.isPending || (requiresTurnstile && !turnstileToken) || !!subdomainRuleError || (plansForAccount.length > 0 && !selectedPlanId)}
              >
                {createHostingMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t.createHosting.creating}
                  </>
                ) : (
                  <>
                    {t.createHosting.createHosting}
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </Button>
            </form>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default CreateHosting;
