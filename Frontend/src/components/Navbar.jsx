import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Wallet, Github } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/context/AuthContext";

export default function Navbar() {
  const [isDark, setIsDark] = useState(false);
  const [isGithubConnected, setIsGithubConnected] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isConnected, currentUser, login } = useAuth();

  useEffect(() => {
    // Check if URL has token or OAuth code from callback
    const queryParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = queryParams.get("token");
    const codeFromUrl = queryParams.get("code");

    if (tokenFromUrl) {
      localStorage.setItem("github_token", tokenFromUrl);
      setIsGithubConnected(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      toast({ title: "Connected", description: "GitHub connected successfully!" });
    } else if (codeFromUrl) {
      fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeFromUrl }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.access_token) {
            localStorage.setItem("github_token", data.access_token);
            setIsGithubConnected(true);
            window.history.replaceState({}, document.title, window.location.pathname);
            toast({ title: "Connected", description: "GitHub connected successfully!" });
            window.location.reload();
          }
        })
        .catch((err) => console.error("Code exchange failed:", err));
    } else {
      const savedGithubToken = localStorage.getItem("github_token");
      if (savedGithubToken) {
        setIsGithubConnected(true);
      }
    }
  }, [toast]);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  const connectWallet = async () => {
    if (!isConnected) {
      await login();
    }
  };

  const handleGithubConnection = () => {
    if (isGithubConnected) {
      // Disconnect
      localStorage.removeItem("github_token");
      setIsGithubConnected(false);
      toast({ title: "Disconnected", description: "GitHub disconnected." });
      window.location.reload();
    } else {
      // Connect using GitHub OAuth
      window.location.href = "/auth/github";
    }
  };

  return (
    <nav className="fixed top-0 w-full z-50 glass border-b border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-black/70 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex-shrink-0 cursor-pointer" onClick={() => navigate("/")}>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-purple-700">
              Udyamita
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
              onClick={connectWallet}
            >
              <Wallet className="h-5 w-5" />
              <span>
                {isConnected && currentUser?.wallet
                  ? `${currentUser.wallet.slice(0, 6)}...${currentUser.wallet.slice(-4)}`
                  : "Connect Wallet"}
              </span>
            </Button>

            <Button
              variant={isGithubConnected ? "default" : "outline"}
              className="flex items-center space-x-2 border-primary/20"
              onClick={handleGithubConnection}
            >
              <Github className="h-5 w-5" />
              <span>{isGithubConnected ? "Disconnect GitHub" : "Connect GitHub"}</span>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
