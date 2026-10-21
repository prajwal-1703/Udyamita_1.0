require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:8080";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "Ov23liE3RGzaFceTnrDf";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "b0d9d938dbb02fdd2c546974dc0a5cd1f29e203c";

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// Health Check
app.get("/", (req, res) => {
  res.send("🚀 Udyamita GitHub OAuth Server is running!");
});

// 1. Initiate GitHub OAuth Redirect
app.get("/auth/github", (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=read:user,user:email,public_repo,repo`;
  console.log(`Redirecting to GitHub OAuth: ${githubAuthUrl}`);
  res.redirect(githubAuthUrl);
});

// 2. GitHub OAuth Callback
app.get("/auth/github/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    console.error("No code returned from GitHub OAuth");
    return res.redirect(`${CLIENT_URL}/?error=no_code_provided`);
  }

  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      },
      {
        headers: { Accept: "application/json" },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      console.error("Failed to obtain access token:", tokenResponse.data);
      return res.redirect(`${CLIENT_URL}/?error=token_exchange_failed`);
    }

    console.log("GitHub OAuth token received successfully.");
    // Redirect back to frontend dashboard with the token
    res.redirect(`${CLIENT_URL}/dashboard?token=${accessToken}`);
  } catch (error) {
    console.error("Error exchanging code for token:", error.message);
    res.redirect(`${CLIENT_URL}/?error=${encodeURIComponent(error.message)}`);
  }
});

// 3. API endpoint for programmatic token exchange
app.post("/api/auth/token", async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      },
      {
        headers: { Accept: "application/json" },
      }
    );

    if (tokenResponse.data.error) {
      return res.status(400).json(tokenResponse.data);
    }

    res.json(tokenResponse.data);
  } catch (error) {
    console.error("API Token exchange error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORTS = [3000, 5000];

PORTS.forEach((p) => {
  const server = app.listen(p, () => {
    console.log(`✅ GitHub OAuth Server listening on http://localhost:${p}`);
  });
  server.on("error", (err) => {
    console.log(`Note: Port ${p} could not be bound (${err.message})`);
  });
});
