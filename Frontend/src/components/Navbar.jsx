import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Wallet, Github } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/context/AuthContext";

export default function Navbar() {
  const [isDark, setIsDark] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { wallet, github, connectWallet, connectGithub, disconnectGithub } = useAuth();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("github") === "linked") toast({ title: "GitHub connected", description: "Your GitHub identity was verified." });
    if (q.get("error")) toast({ variant: "destructive", title: "GitHub sign-in failed", description: q.get("error") });
    if (q.get("github") || q.get("error")) window.history.replaceState({}, document.title, window.location.pathname);
  }, [toast]);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  const onWallet = async () => {
    try { if (!wallet) await connectWallet(); }
    catch (e) { toast({ variant: "destructive", title: "Wallet", description: e.message }); }
  };

  const handleGithubConnection = async () => {
    if (github) { await disconnectGithub(); toast({ title: "Disconnected", description: "GitHub session ended." }); }
    else connectGithub();
  };

  return (
    <nav className="fixed top-0 w-full z-50 glass border-b border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-black/70 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex-shrink-0 cursor-pointer" onClick={() => navigate("/")}>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-purple-700">
              BlockSource
            </h1>
          </div>

          <div className="flex items-center space-x-4">
            <Button variant="ghost" onClick={() => navigate("/Leaderboard")} className="hover:text-purple-600">
              Leaderboard
            </Button>

            <Button variant="ghost" onClick={() => navigate("/dashboard")} className="hover:text-purple-600">
              Dashboard
            </Button>

            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>

            <Button
              variant="outline"
              className="flex items-center space-x-2 bg-primary/10 hover:bg-primary/20 border-primary/20"
              onClick={onWallet}
            >
              <Wallet className="h-5 w-5" />
              <span>
                {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Wallet"}
              </span>
            </Button>

            <Button
              variant={github ? "default" : "outline"}
              className="flex items-center space-x-2 border-primary/20"
              onClick={handleGithubConnection}
            >
              <Github className="h-5 w-5" />
              <span>{github ? `@${github.login}` : "Connect GitHub"}</span>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
