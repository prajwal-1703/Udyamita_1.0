import React, { useCallback, useEffect, useState } from "react";
import { ethers, formatUnits, parseUnits } from "ethers";
import Navbar from "@/components/Navbar";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Award, CheckCircle2, Circle, Clock, Code, ExternalLink, GitFork, Github, Loader2, RefreshCw, Star, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { contracts, readProvider, revertReason, signerContracts, txUrl, addressUrl } from "@/lib/chain";
import { progressToNext, roleFor, titleFor, XP_PER_CONTRIBUTION } from "@/lib/progression";
import { CONTRACTS, DEPLOY_BLOCK, UCOIN_DECIMALS, contractsConfigured } from "@/config";

const fmt = (wei, digits = 4) => Number(formatUnits(wei ?? 0n, UCOIN_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: digits });

function Step({ done, active, title, children }) {
  return (
    <div className={`flex gap-3 p-3 rounded-lg border ${active ? "border-primary/50 bg-primary/5" : "border-transparent"}`}>
      {done ? <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" /> : <Circle className="h-5 w-5 text-muted-foreground mt-0.5" />}
      <div className="flex-grow">
        <p className={`font-medium ${done ? "text-muted-foreground" : ""}`}>{title}</p>
        {active && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

const Dashboard = () => {
  const { wallet, github, profile, loading, connectWallet, connectGithub, refresh, loadProfile } = useAuth();
  const { toast } = useToast();

  const [busy, setBusy] = useState("");                 // which action is running
  const [rewards, setRewards] = useState(null);         // { balance, claimed, pending, available }
  const [ghPublic, setGhPublic] = useState(null);       // public GitHub profile + repos
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [pendingList, setPendingList] = useState([]);
  const [history, setHistory] = useState([]);

  const registered = !!profile;
  const linkedElsewhere = github?.wallet && wallet && github.wallet.toLowerCase() !== wallet.toLowerCase();

  // ---------------------------------------------------------------- reads
  const loadRewards = useCallback(async () => {
    if (!wallet || !contractsConfigured()) { setRewards(null); return; }
    const { rewardMechanism, ucoin } = contracts(readProvider());
    const [balance, claimed, pending, available] = await Promise.all([
      ucoin.balanceOf(wallet), rewardMechanism.claimed(wallet), rewardMechanism.getPendingRequest(wallet), rewardMechanism.available(wallet),
    ]);
    setRewards({ balance, claimed, pending: { isPending: pending[0], amount: pending[1] }, available });
    const owner = await rewardMechanism.owner();
    setIsOwner(owner.toLowerCase() === wallet.toLowerCase());
  }, [wallet]);

  const loadGithubPublic = useCallback(async (login) => {
    if (!login) { setGhPublic(null); return; }
    try {
      // Public endpoints only; no user token is needed or stored.
      const [u, repos] = await Promise.all([
        fetch(`https://api.github.com/users/${encodeURIComponent(login)}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=updated&per_page=3`).then((r) => (r.ok ? r.json() : [])),
      ]);
      setGhPublic(u ? { ...u, repos } : null);
    } catch { setGhPublic(null); }
  }, []);

  const loadOwnerData = useCallback(async () => {
    if (!isOwner) return;
    const { rewardMechanism } = contracts(readProvider());
    const reqs = await rewardMechanism.queryFilter(rewardMechanism.filters.WithdrawalRequested(), DEPLOY_BLOCK);
    const users = [...new Set(reqs.map((e) => e.args.user))];
    const states = await Promise.all(users.map(async (u) => [u, await rewardMechanism.getPendingRequest(u)]));
    setPendingList(states.filter(([, s]) => s[0]).map(([u, s]) => ({ user: u, amount: s[1] })));
    const approved = await rewardMechanism.queryFilter(rewardMechanism.filters.WithdrawalApproved(), DEPLOY_BLOCK);
    setHistory(approved.reverse().map((e) => ({ user: e.args.user, amount: e.args.amount, tx: e.transactionHash, block: e.blockNumber })));
  }, [isOwner]);

  useEffect(() => { loadRewards().catch(console.error); }, [loadRewards, profile]);
  useEffect(() => { loadGithubPublic(profile?.login || github?.login); }, [profile?.login, github?.login, loadGithubPublic]);
  useEffect(() => { loadOwnerData().catch(console.error); }, [loadOwnerData]);

  // Refresh when the contracts emit events about this wallet (replaces v1.0's 15 s/30 s polling).
  useEffect(() => {
    if (!wallet || !contractsConfigured() || !window.ethereum) return undefined;
    const { userDatabase, rewardMechanism } = contracts(new ethers.BrowserProvider(window.ethereum));
    const onChange = () => { loadProfile(wallet); loadRewards(); loadOwnerData(); };
    const filters = [
      userDatabase.filters.UserXPUpdated(wallet), rewardMechanism.filters.WithdrawalRequested(wallet),
      rewardMechanism.filters.WithdrawalApproved(null, wallet), rewardMechanism.filters.WithdrawalRejected(null, wallet),
    ];
    filters.forEach((f, i) => (i === 0 ? userDatabase : rewardMechanism).on(f, onChange));
    return () => { userDatabase.removeAllListeners(); rewardMechanism.removeAllListeners(); };
  }, [wallet, loadProfile, loadRewards, loadOwnerData]);

  // ---------------------------------------------------------------- actions
  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); }
    catch (e) { toast({ variant: "destructive", title: "Something went wrong", description: e.message }); }
    finally { setBusy(""); }
  };

  const linkOnChain = () => run("link", async () => {
    const att = await api.attest(wallet); // backend signs Bind(wallet, githubId, login, deadline)
    const { userDatabase } = await signerContracts();
    try {
      const tx = await userDatabase.register(att.githubId, att.login, att.deadline, att.signature);
      toast({ title: "Linking...", description: `@${att.login} -> ${wallet.slice(0, 8)}...` });
      await tx.wait();
    } catch (e) { throw new Error(revertReason(e, userDatabase.interface)); }
    await refresh();
    toast({ title: "Linked", description: "Your GitHub account is now bound to this wallet on chain." });
  });

  const syncNow = () => run("sync", async () => {
    try {
      const r = await api.sync();
      if (!r.changed) toast({ title: "Up to date", description: `${r.count} public contributions already counted.` });
      else {
        toast({ title: "Sync submitted", description: `${r.count} contributions -> ${r.count * XP_PER_CONTRIBUTION} XP. Waiting for the block...` });
        await readProvider().waitForTransaction(r.txHash);
        await loadProfile(wallet); await loadRewards();
      }
    } catch (e) {
      if (e.status === 429) throw new Error(`Please wait ${e.data.retryAfterSeconds}s before syncing again.`);
      throw e;
    }
  });

  const requestWithdrawal = () => run("request", async () => {
    const wei = parseUnits(amount, UCOIN_DECIMALS);
    const { rewardMechanism } = await signerContracts();
    try { await (await rewardMechanism.requestWithdrawal(wei)).wait(); }
    catch (e) { throw new Error(revertReason(e, rewardMechanism.interface)); }
    setDialogOpen(false); setAmount("");
    await loadRewards();
    toast({ title: "Withdrawal requested", description: "Small amounts are paid instantly; larger ones wait for review." });
  });

  const cancelWithdrawal = () => run("cancel", async () => {
    const { rewardMechanism } = await signerContracts();
    await (await rewardMechanism.cancelWithdrawal()).wait();
    await loadRewards();
  });

  const ownerAction = (user, approve) => run(`owner-${user}`, async () => {
    const { rewardMechanism } = await signerContracts();
    try { await (await (approve ? rewardMechanism.approveWithdrawal(user) : rewardMechanism.rejectWithdrawal(user))).wait(); }
    catch (e) { throw new Error(revertReason(e, rewardMechanism.interface)); }
    await loadOwnerData();
  });

  const addTokenToMetaMask = () => window.ethereum?.request({
    method: "wallet_watchAsset", params: { type: "ERC20", options: { address: CONTRACTS.ucoin, symbol: "UCN", decimals: UCOIN_DECIMALS } },
  });

  // ---------------------------------------------------------------- derived
  const xp = profile?.xp ?? 0;
  const prog = progressToNext(xp);
  const level = profile?.level ?? 0;
  const amountWei = (() => { try { return amount ? parseUnits(amount, UCOIN_DECIMALS) : 0n; } catch { return -1n; } })();
  const amountInvalid = amountWei <= 0n || (rewards && amountWei > rewards.available);

  if (!contractsConfigured()) {
    return (<div className="min-h-screen bg-background"><Navbar /><main className="pt-24 px-4 max-w-3xl mx-auto">
      <Card><CardHeader><CardTitle>Not configured</CardTitle><CardDescription>Set the VITE_*_ADDRESS variables in Frontend/.env (see .env.example).</CardDescription></CardHeader></Card>
    </main></div>);
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 px-4 max-w-7xl mx-auto pb-12">
        {loading && (<div className="flex justify-center items-center my-16"><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-4 text-lg text-muted-foreground">Loading Dashboard...</p></div>)}

        {!loading && !registered && (
          <Card className="glass max-w-2xl mx-auto">
            <CardHeader><CardTitle>Get started</CardTitle><CardDescription>Four steps link your GitHub work to on-chain XP and UCoin.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              <Step done={!!wallet} active={!wallet} title="1. Connect your wallet">
                <Button onClick={() => run("wallet", connectWallet)} className="gap-2"><Wallet className="h-4 w-4" /> Connect MetaMask</Button>
              </Step>
              <Step done={!!github} active={!!wallet && !github} title="2. Sign in with GitHub">
                <p className="text-sm text-muted-foreground mb-2">Only your public profile is requested (read:user). No repository access, no token stored in the browser.</p>
                <Button onClick={connectGithub} className="gap-2"><Github className="h-4 w-4" /> Sign in with GitHub</Button>
              </Step>
              <Step done={registered} active={!!wallet && !!github && !registered} title="3. Link GitHub and wallet on chain">
                {linkedElsewhere
                  ? <p className="text-sm text-destructive">@{github.login} is already linked to {github.wallet}. Switch to that wallet in MetaMask.</p>
                  : <Button onClick={linkOnChain} disabled={busy === "link"}>{busy === "link" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Link @{github?.login}</Button>}
              </Step>
              <Step done={false} active={false} title="4. Sync your contributions" />
            </CardContent>
          </Card>
        )}

        {!loading && registered && (
          <>
            {profile.suspended && (<div className="mb-6 p-3 rounded-md border border-destructive text-destructive">This account is suspended. XP and withdrawals are paused; contact the maintainers.</div>)}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="glass">
                <CardHeader><CardTitle>Level {level}</CardTitle><CardDescription>{titleFor(level)}</CardDescription></CardHeader>
                <CardContent>
                  <Progress value={prog.pct} />
                  <p className="text-sm text-muted-foreground mt-2">XP: <span className="font-semibold">{xp.toLocaleString()}</span>{prog.nextXp ? ` / ${prog.nextXp.toLocaleString()}` : " (max level)"}</p>
                  {prog.nextXp && <p className="text-xs text-muted-foreground">{prog.remaining.toLocaleString()} XP ({Math.ceil(prog.remaining / XP_PER_CONTRIBUTION)} contributions) to level {level + 1}</p>}
                </CardContent>
              </Card>

              <Card className="glass">
                <CardHeader><CardTitle>Contribution Overview</CardTitle><CardDescription>All-time public contributions, as recorded on chain</CardDescription></CardHeader>
                <CardContent className="space-y-2">
                  <p>Role: <Badge variant="secondary">{roleFor(xp)}</Badge></p>
                  <p>Counted contributions: <span className="font-semibold">{(xp / XP_PER_CONTRIBUTION).toLocaleString()}</span></p>
                  <p className="text-sm text-muted-foreground">Last synced: {profile.lastSync ? new Date(profile.lastSync * 1000).toLocaleString() : "never"}</p>
                  <Button variant="outline" size="sm" onClick={syncNow} disabled={busy === "sync" || !github} className="gap-2">
                    {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now
                  </Button>
                  {!github && <p className="text-xs text-muted-foreground">Sign in with GitHub to sync on demand; the backend also syncs everyone periodically.</p>}
                </CardContent>
              </Card>

              {!isOwner && (
                <Card className="glass">
                  <CardHeader><CardTitle>UCoin Rewards</CardTitle><CardDescription>Entitlements are enforced by the contract</CardDescription></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between items-center"><span className="text-muted-foreground flex items-center gap-1"><Wallet className="h-4 w-4" /> Wallet balance</span>
                      <span className="text-lg font-bold">{fmt(rewards?.balance)} UCN</span></div>
                    <Button variant="link" size="sm" onClick={addTokenToMetaMask} className="text-xs p-0 h-auto">+ Import UCN to MetaMask</Button>
                    <div className="border-t pt-3 space-y-1">
                      <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><Award className="h-4 w-4" /> Earned (level {level})</span><span>{fmt(profile.earned)} UCN</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Claimed</span><span>{fmt(rewards?.claimed)} UCN</span></div>
                      <div className="flex justify-between font-semibold text-green-600 dark:text-green-400"><span>Available</span><span>{fmt(rewards?.available)} UCN</span></div>
                    </div>
                    {rewards?.pending.isPending ? (
                      <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-md">
                        <div className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4" /> {fmt(rewards.pending.amount)} UCN awaiting review</div>
                        <Button variant="ghost" size="sm" onClick={cancelWithdrawal} disabled={busy === "cancel"} className="mt-1 h-auto p-0 text-xs">Cancel request</Button>
                      </div>
                    ) : (
                      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                          <Button className="w-full" disabled={!rewards || rewards.available <= 0n || profile.suspended}>Request withdrawal</Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                          <DialogHeader><DialogTitle>Withdraw UCoin</DialogTitle>
                            <DialogDescription>Up to {fmt(rewards?.available)} UCN. The contract rejects anything above your on-chain entitlement.</DialogDescription></DialogHeader>
                          <div className="grid gap-2 py-2">
                            <Label htmlFor="amt">Amount (UCN)</Label>
                            <Input id="amt" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
                            <Button variant="link" size="sm" className="justify-start p-0 h-auto text-xs" onClick={() => setAmount(formatUnits(rewards?.available ?? 0n, UCOIN_DECIMALS))}>Use maximum</Button>
                            {amount && amountInvalid && <p className="text-xs text-destructive">Enter a positive amount within your available balance.</p>}
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                            <Button onClick={requestWithdrawal} disabled={amountInvalid || busy === "request"}>{busy === "request" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Confirm</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <Card className="glass">
                <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-6 w-6" /> Wallet</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm font-mono break-all bg-muted p-2 rounded">{wallet}</p>
                  <Button variant="outline" size="sm" onClick={() => window.open(addressUrl(wallet), "_blank")}>View on explorer <ExternalLink className="h-3 w-3 ml-1" /></Button>
                </CardContent>
              </Card>
              <Card className="glass">
                <CardHeader><CardTitle className="flex items-center gap-2"><Github className="h-6 w-6" /> GitHub</CardTitle><CardDescription>Linked account #{profile.githubId}</CardDescription></CardHeader>
                <CardContent>
                  {ghPublic ? (
                    <div className="flex items-start gap-4">
                      <img src={ghPublic.avatar_url} className="w-16 h-16 rounded-full border" alt="" />
                      <div>
                        <h3 className="text-xl font-bold">{ghPublic.name || ghPublic.login}</h3>
                        <a className="text-sm text-primary hover:underline" href={ghPublic.html_url} target="_blank" rel="noopener noreferrer">@{ghPublic.login}</a>
                        <div className="flex gap-2 mt-2 flex-wrap"><Badge variant="secondary">{ghPublic.public_repos} repos</Badge><Badge variant="secondary">{ghPublic.followers} followers</Badge></div>
                      </div>
                    </div>
                  ) : <p className="text-muted-foreground">@{profile.login}</p>}
                </CardContent>
              </Card>
            </div>

            {ghPublic?.repos?.length > 0 && (
              <Card className="glass mt-6">
                <CardHeader><CardTitle>Recently updated repositories</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {ghPublic.repos.map((r) => (
                    <div key={r.id} className="border rounded-lg p-4">
                      <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{r.full_name}</a>
                      <p className="text-sm text-muted-foreground mt-1">{r.description || "No description."}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                        {r.language && <span className="flex items-center gap-1"><Code className="h-3 w-3" />{r.language}</span>}
                        <span className="flex items-center gap-1"><Star className="h-3 w-3" />{r.stargazers_count}</span>
                        <span className="flex items-center gap-1"><GitFork className="h-3 w-3" />{r.forks_count}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!loading && isOwner && (
          <Card className="glass mt-6">
            <CardHeader><CardTitle>Owner Dashboard</CardTitle><CardDescription>Requests are already capped at each user's on-chain entitlement; review is a fraud check.</CardDescription></CardHeader>
            <CardContent>
              <Tabs defaultValue="pending">
                <TabsList><TabsTrigger value="pending">Pending ({pendingList.length})</TabsTrigger><TabsTrigger value="history">Paid</TabsTrigger></TabsList>
                <TabsContent value="pending" className="space-y-3 mt-4">
                  {pendingList.length === 0 && <p className="text-muted-foreground text-center py-6">No pending requests.</p>}
                  {pendingList.map((p) => (
                    <div key={p.user} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg gap-3">
                      <div><p className="font-mono text-sm break-all">{p.user}</p><p className="font-semibold">{fmt(p.amount)} UCN</p></div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => ownerAction(p.user, true)} disabled={!!busy}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => ownerAction(p.user, false)} disabled={!!busy}>Reject</Button>
                      </div>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="history">
                  <Table>
                    <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Amount</TableHead><TableHead>Block</TableHead><TableHead>Tx</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {history.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground h-20">No payouts yet.</TableCell></TableRow>}
                      {history.map((h) => (
                        <TableRow key={h.tx}>
                          <TableCell className="font-mono text-xs break-all">{h.user}</TableCell>
                          <TableCell>{fmt(h.amount)} UCN</TableCell>
                          <TableCell>{h.block}</TableCell>
                          <TableCell><a className="text-primary text-xs font-mono hover:underline" href={txUrl(h.tx)} target="_blank" rel="noopener noreferrer">{h.tx.slice(0, 10)}...</a></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
