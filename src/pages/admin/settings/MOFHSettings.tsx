import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import {
  Server,
  Eye,
  EyeOff,
  Save,
  TestTube,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Copy,
  Globe,
  Network,
  Plus,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLanguage } from "@/contexts/LanguageContext";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

/** 一个 MOFH 分销账号（= 一套 apiUsername/apiPassword） */
interface MOFHAccountDraft {
  id?: string;
  name: string;
  apiUsername: string;
  apiPassword: string;
  enabled: boolean;
  defaultPackage?: string;
  cpanelUrl?: string;
  customNameservers?: string;
  /** 允许使用该账号的用户等级 id 列表（空 = 所有等级都能用） */
  allowedLevelIds?: string[];
  note?: string;
}

interface MOFHConfig {
  enabled: boolean;
  strategy: 'least-loaded' | 'round-robin';
  defaultPackage: string;
  cpanelUrl: string;
  customNameservers?: string;
  accounts: MOFHAccountDraft[];
}

const emptyAccount = (): MOFHAccountDraft => ({
  name: "",
  apiUsername: "",
  apiPassword: "",
  enabled: true,
  defaultPackage: "",
  cpanelUrl: "",
  customNameservers: "",
  note: "",
});

const MOFHSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const mt = t.admin?.mofh || {} as any;
  const [serverIp, setServerIp] = useState<string>("");
  const [loadingIp, setLoadingIp] = useState(true);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [config, setConfig] = useState<MOFHConfig>({
    enabled: false,
    strategy: "least-loaded",
    defaultPackage: "",
    cpanelUrl: "",
    customNameservers: "",
    accounts: [],
  });

  // Fetch current MOFH settings
  const { data: settingsData, isLoading: loadingSettings } = useQuery({
    queryKey: ["mofh-settings"],
    queryFn: async () => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_URL}/api/settings/mofh`, {
        headers: {
          Authorization: "Bearer ${token}",
        },
      });
      if (!response.ok) throw new Error("Failed to fetch MOFH settings");
      return response.json();
    },
    staleTime: 1000 * 60, // 1 minute
  });

  // Fetch server public IP from backend
  useEffect(() => {
    const fetchServerIp = async () => {
      try {
        const token = localStorage.getItem("accessToken");
        const response = await fetch(`${API_URL}/api/settings/server-ip`, {
          headers: {
            Authorization: "Bearer ${token}",
          },
        });
        if (response.ok) {
          const data = await response.json();
          setServerIp(data.ip);
        } else {
          setServerIp(mt.cannotGetIp || 'Cannot get IP');
        }
      } catch (error) {
        console.error('Failed to fetch server IP:', error);
        setServerIp(mt.cannotGetIp || 'Cannot get IP');
      } finally {
        setLoadingIp(false);
      }
    };
    fetchServerIp();
  }, []);

  // Update settings from API
  useEffect(() => {
    if (settingsData?.settings) {
      const s = settingsData.settings;
      setConfig({
        enabled: s.enabled ?? false,
        strategy: s.strategy === 'round-robin' ? 'round-robin' : 'least-loaded',
        defaultPackage: s.defaultPackage || "",
        cpanelUrl: s.cpanelUrl || "",
        customNameservers: s.customNameservers || "",
        accounts: Array.isArray(s.accounts) ? s.accounts : [],
      });
    }
  }, [settingsData]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: MOFHConfig) => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_URL}/api/settings/mofh`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ${token}",
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save settings");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mofh-settings"] });
      toast({
        title: mt.savedSuccess || "Saved successfully",
        description: mt.savedDesc || "MOFH API settings have been updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: mt.serverError || "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Test one account
  const testMutation = useMutation({
    mutationFn: async (payload: { accountId?: string; apiUsername?: string; apiPassword?: string; index: number }) => {
      const token = localStorage.getItem("accessToken");
      setTestingIndex(payload.index);
      const response = await fetch(`${API_URL}/api/settings/mofh/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ${token}",
        },
        body: JSON.stringify({
          accountId: payload.accountId,
          apiUsername: payload.apiUsername,
          apiPassword: payload.apiPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.error || "Connection failed",
          apiVersion: data.apiVersion,
        };
      }
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: mt.connectionSuccess || "Connection successful",
          description: data.message || mt.connectionSuccessDesc || "MOFH API connected successfully",
        });
      } else {
        toast({
          title: mt.connectionFailed || "Connection failed",
          description: data.message || mt.connectionFailedDesc || "Cannot connect to MOFH API",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: mt.serverError || "Error",
        description: mt.serverErrorDesc || "Cannot connect to server",
        variant: "destructive",
      });
    },
    onSettled: () => setTestingIndex(null),
  });

  const handleSave = () => {
    saveMutation.mutate(config);
  };

  const { data: levelsData } = useQuery({
    queryKey: ["admin-levels"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/levels/admin`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!r.ok) return { levels: [] as Array<{ id: string; name: string }> };
      return r.json() as Promise<{ levels: Array<{ id: string; name: string }> }>;
    },
  });
  const levels: Array<{ id: string; name: string }> = levelsData?.levels || [];

  const updateAccount = (index: number, patch: Partial<MOFHAccountDraft>) => {
    setConfig((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));
  };

  const addAccount = () => {
    setConfig((prev) => ({ ...prev, accounts: [...prev.accounts, emptyAccount()] }));
  };

  const removeAccount = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      accounts: prev.accounts.filter((_, i) => i !== index),
    }));
  };

  if (loadingSettings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AdminLayout>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{mt.title || 'Hosting API (MOFH)'}</h1>
        <p className="text-muted-foreground">
          {mt.subtitle || 'Configure MyOwnFreeHost API to manage free hosting'}
        </p>
      </div>

      {/* Info Alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{mt.importantNote || 'Important Note'}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            {mt.noteDesc1 || 'MOFH API allows you to create and manage free hosting accounts. Each user is limited to 3 accounts.'}
          </p>
          <p>
            {mt.noteDesc2 || 'To get API credentials, visit:'}{" "}
            <a
              href="https://panel.myownfreehost.net/panel/index2.php?option=api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              {mt.panelApiSettings || 'MOFH Panel → API Settings'}
              <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </AlertDescription>
      </Alert>

      {/* MOFH Accounts */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Server className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle>{mt.accounts || 'MOFH Accounts'}</CardTitle>
                <CardDescription>
                  {mt.accountsDesc || 'Add multiple reseller accounts — new signups are spread across the enabled ones'}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="mofh-enabled">{mt.enabled || 'Enabled'}</Label>
              <Switch
                id="mofh-enabled"
                checked={config.enabled}
                onCheckedChange={(checked) =>
                  setConfig({ ...config, enabled: checked })
                }
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Assignment strategy */}
          <div className="space-y-2">
            <Label>{mt.strategy || 'Assignment Strategy'}</Label>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant={config.strategy === 'least-loaded' ? 'default' : 'outline'}
                onClick={() => setConfig({ ...config, strategy: 'least-loaded' })}
              >
                {mt.strategyLeastLoaded || 'Least loaded'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={config.strategy === 'round-robin' ? 'default' : 'outline'}
                onClick={() => setConfig({ ...config, strategy: 'round-robin' })}
              >
                {mt.strategyRoundRobin || 'Round robin'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mt.strategyHint || 'Least loaded sends each new account to the reseller that currently has the fewest hostings'}
            </p>
          </div>

          {/* Account list */}
          <div className="space-y-3 pt-2 border-t">
            {config.accounts.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {mt.noAccounts || 'No accounts yet'}
                <div className="text-xs mt-1">
                  {mt.noAccountsHint || 'Add at least one MOFH reseller account to start creating hostings'}
                </div>
              </div>
            )}

            {config.accounts.map((account, index) => (
              <div
                key={index}
                className="rounded-lg border p-4 space-y-3 bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Server className="w-4 h-4 text-muted-foreground" />
                    {account.name || `${mt.account || 'Account'} ${index + 1}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`acc-enabled-${index}`} className="text-xs">
                      {mt.enabled || 'Enabled'}
                    </Label>
                    <Switch
                      id={`acc-enabled-${index}`}
                      checked={account.enabled}
                      onCheckedChange={(checked) => updateAccount(index, { enabled: checked })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAccount(index)}
                      title={mt.remove || 'Remove'}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`acc-name-${index}`}>{mt.accountName || 'Name'}</Label>
                    <Input
                      id={`acc-name-${index}`}
                      placeholder={mt.accountNamePlaceholder || 'e.g. Main reseller'}
                      value={account.name}
                      onChange={(e) => updateAccount(index, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`acc-user-${index}`}>{mt.apiUsername || 'API Username'}</Label>
                    <Input
                      id={`acc-user-${index}`}
                      placeholder={mt.apiUsernamePlaceholder || 'Enter API Username from MOFH Panel'}
                      value={account.apiUsername}
                      onChange={(e) => updateAccount(index, { apiUsername: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`acc-pass-${index}`}>{mt.apiPassword || 'API Password'}</Label>
                  <div className="relative">
                    <Input
                      id={`acc-pass-${index}`}
                      type={visiblePasswords[index] ? "text" : "password"}
                      placeholder={mt.apiPasswordPlaceholder || 'Enter API Password from MOFH Panel'}
                      value={account.apiPassword}
                      onChange={(e) => updateAccount(index, { apiPassword: e.target.value })}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setVisiblePasswords((prev) => ({ ...prev, [index]: !prev[index] }))
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {visiblePasswords[index] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* 该账号自己的一套配置：常驻显示，留空则继承下面的全局默认值 */}
                <div className="space-y-3">
                  <div className="text-xs font-medium">
                    {mt.advancedOptions || "This account's own settings"}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {mt.advancedOptionsHint || 'Leave blank to inherit the global default'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`acc-pkg-${index}`}>{mt.defaultPackage || 'Package'}</Label>
                      <Input
                        id={`acc-pkg-${index}`}
                        placeholder={`${mt.inheritPrefix || 'Inherit: '}${config.defaultPackage || '—'}`}
                        value={account.defaultPackage || ""}
                        onChange={(e) => updateAccount(index, { defaultPackage: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`acc-cpanel-${index}`}>{mt.cpanelUrl || 'cPanel URL'}</Label>
                      <Input
                        id={`acc-cpanel-${index}`}
                        placeholder={`${mt.inheritPrefix || 'Inherit: '}${config.cpanelUrl || '—'}`}
                        value={account.cpanelUrl || ""}
                        onChange={(e) => updateAccount(index, { cpanelUrl: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`acc-ns-${index}`}>{mt.customNameservers || 'Nameservers'}</Label>
                      <Input
                        id={`acc-ns-${index}`}
                        placeholder={`${mt.inheritPrefix || 'Inherit: '}${config.customNameservers || '—'}`}
                        value={account.customNameservers || ""}
                        onChange={(e) => updateAccount(index, { customNameservers: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`acc-note-${index}`}>{mt.note || 'Note'}</Label>
                      <Input
                        id={`acc-note-${index}`}
                        placeholder={mt.notePlaceholder || 'Optional remark for yourself'}
                        value={account.note || ""}
                        onChange={(e) => updateAccount(index, { note: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* 该账号只给哪些等级用 */}
                  <div className="space-y-2">
                    <Label>{mt.allowedLevels || 'Available to levels'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {mt.allowedLevelsHint || 'Leave all unchecked so every level can use this account.'}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {levels.map((l) => {
                        const ids = account.allowedLevelIds || [];
                        return (
                          <label
                            key={l.id}
                            className="flex items-center gap-2 text-sm rounded-md border px-3 py-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={ids.includes(l.id)}
                              onChange={(e) =>
                                updateAccount(index, {
                                  allowedLevelIds: e.target.checked
                                    ? [...ids, l.id]
                                    : ids.filter((x) => x !== l.id),
                                })
                              }
                            />
                            <span>{l.name}</span>
                          </label>
                        );
                      })}
                      {levels.length === 0 && (
                        <p className="text-xs text-muted-foreground col-span-full">
                          {mt.noLevelsYet || 'No levels configured yet.'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!account.apiUsername || testingIndex === index}
                    onClick={() =>
                      testMutation.mutate({
                        accountId: account.id,
                        apiUsername: account.apiUsername,
                        apiPassword: account.apiPassword,
                        index,
                      })
                    }
                  >
                    {testingIndex === index ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4 mr-2" />
                    )}
                    {mt.testAccount || 'Test'}
                  </Button>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addAccount}>
              <Plus className="w-4 h-4 mr-2" />
              {mt.addAccount || 'Add Account'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Global defaults + server info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              {mt.defaults || 'Global Defaults'}
            </CardTitle>
            <CardDescription>
              {mt.defaultsDesc || 'Used for any account that does not override them'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-package">{mt.defaultPackage || 'Default Package'}</Label>
              <Input
                id="default-package"
                placeholder={mt.defaultPackagePlaceholder || 'Enter package name (e.g. Default)'}
                value={config.defaultPackage}
                onChange={(e) =>
                  setConfig({ ...config, defaultPackage: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                {mt.defaultPackageHint || 'Hosting package name from MOFH Panel'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cpanel-url" className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {mt.cpanelUrl || 'cPanel URL'}
              </Label>
              <Input
                id="cpanel-url"
                placeholder={mt.cpanelUrlPlaceholder || 'cpanel.yourdomain.com'}
                value={config.cpanelUrl}
                onChange={(e) =>
                  setConfig({ ...config, cpanelUrl: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                {mt.cpanelUrlHint || 'cPanel URL displayed to users'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-nameservers" className="flex items-center gap-2">
                <Network className="w-4 h-4" />
                {mt.customNameservers || 'Custom Nameservers'}
              </Label>
              <Input
                id="custom-nameservers"
                placeholder={mt.customNameserversPlaceholder || 'ns1.example.com, ns2.example.com'}
                value={config.customNameservers || ""}
                onChange={(e) =>
                  setConfig({ ...config, customNameservers: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                {mt.customNameserversHint || 'Nameservers for custom domains (comma-separated). Leave empty to use ns1-ns5.byet.org'}
              </p>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t">
              <Button
                onClick={handleSave}
                size="sm"
                disabled={saveMutation.isPending}
                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {mt.saveSettings || 'Save Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Server Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="w-5 h-5" />
              {mt.serverInfo || 'Server Information'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Callback URL */}
            <div className="space-y-2">
              <Label htmlFor="callback-url">{mt.callbackUrl || 'Callback URL'}</Label>
              <div className="flex gap-2">
                <Input
                  id="callback-url"
                  value={`${window.location.origin}/api/mofh/callback`}
                  readOnly
                  className="bg-muted text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/api/mofh/callback`);
                    toast({
                      title: mt.copied || "Copied",
                      description: mt.callbackCopied || "Callback URL has been copied",
                    });
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mt.callbackUrlHint || 'Paste into MOFH Panel → API Settings'}
              </p>
            </div>

            {/* Server Public IP */}
            <div className="space-y-2">
              <Label htmlFor="server-ip">{mt.serverIp || 'Server IP'}</Label>
              <div className="flex gap-2">
                <Input
                  id="server-ip"
                  value={loadingIp ? "Loading..." : serverIp}
                  readOnly
                  className="bg-muted font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={loadingIp || !serverIp}
                  onClick={() => {
                    navigator.clipboard.writeText(serverIp);
                    toast({
                      title: mt.copied || "Copied",
                      description: mt.ipCopied || "Server IP has been copied",
                    });
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mt.serverIpHint || 'Add this IP to MOFH whitelist'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </AdminLayout>
  );
};

export default MOFHSettings;
