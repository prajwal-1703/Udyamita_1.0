# 🚀 BlockSource: Code to Crypto

A decentralized platform that rewards open-source contributors with crypto tokens. Built on top of GitHub and Ethereum, BlockSource transforms meaningful contributions into provable reputation and tangible value.

---

## 🌟 Features

- 🔗 **Web3 + GitHub Integration**  
  Connect your GitHub & MetaMask wallet. Contributions (PushEvents, PRs, etc.) are tracked via GitHub API.

- 🧠 **XP-Based Progression System**  
  Earn XP for each event (50 XP per contribution). Level up and earn ranks from *Apprentice* to *Supreme*.

- 💰 **Crypto Rewards with UCoin (UCN)**  
  XP milestones convert into `UCN` tokens — an ERC-20 token deployed on the Ethereum Sepolia testnet.

- 🏆 **Contributor Roles & Titles**  
  Over 20 titles and 100 levels. Roles unlock governance rights and platform perks.

- 🧪 **Smart Contract Integration**  
  Token contracts built with Hardhat and deployed on Sepolia.

---

## 🛠 Tech Stack

| Layer      | Tech                           |
|------------|--------------------------------|
| Frontend   | React, Tailwind CSS, Vite      |
| Web3       | Ethers.js, MetaMask            |
| Blockchain | Ethereum (Sepolia), Hardhat    |
| Auth       | GitHub Token (Local) + MetaMask |

---

## ⚙️ Getting Started

### 📦 Prerequisites

- Node.js (v18 or above)
- Git
- MetaMask wallet
- GitHub Personal Access Token (for stats tracking)

---

### 🖥️ Local Setup

#### 1️⃣ Clone the Repository

```bash
git clone https://github.com/Udyamita108/Udyamita_1.0.git
cd Udyamita_1.0
```

#### 2️⃣ Smart Contract Setup (Optional - if deploying new contracts)

The project comes with pre-deployed contracts on Sepolia. To deploy your own:

```bash
cd Blockchain
npm install
npx hardhat run scripts/deploy.js --network sepolia
```

> Update `hardhat.config.js` and `.env` in `Blockchain` folder with your Alchemy/Infura keys and Private Key.

#### 3️⃣ Start the Frontend

Open a **new terminal**:

```bash
cd Frontend
npm install
npm run dev
```

> The application will run at `http://localhost:5173`.

---

## 🔐 Authentication

- **MetaMask Wallet**: Connect your wallet to interact with the blockchain (register, withdraw rewards).
- **GitHub Token**: Enter your GitHub Personal Access Token (PAT) when prompted to track your contributions and XP. The token is stored locally in your browser.

---

## 💸 Tokenomics

- **Token Name**: UCoin
- **Symbol**: UCN
- **Supply**: Fixed
  - 70% → Reward Treasury
  - 30% → Dev Wallet

Smart contracts are upgradeable and currently live on the **Sepolia testnet**.

---

## 🧮 XP & Title System

- **50 XP** per GitHub contribution (calculated client-side based on stats).
- **20+ Titles**, 100+ levels
- Roles:
  - 👨‍💻 Contributor (0 – 15,000 XP)
  - 🔍 Reviewer (15,000+ XP)
  - 🧙‍♂️ Supreme (505,000+ XP)

---

## 📬 Contributing

We ❤️ contributors! To get involved:

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Push to your branch and open a PR
4. Wait for review and merge

---

## 🧪 Testing & Contracts

Smart contracts are in the `Blockchain` directory.

To deploy locally:

```bash
cd Blockchain
npx hardhat run scripts/deploy.js --network localhost
```

To deploy on Sepolia:

```bash
cd Blockchain
npx hardhat run scripts/deploy.js --network sepolia
```

---

## 🔗 Useful Links

- [Sepolia Explorer](https://sepolia.etherscan.io/)
- [MetaMask](https://metamask.io/)
- [GitHub OAuth Setup](https://docs.github.com/en/developers/apps/building-oauth-apps)

---

## 📄 License

This project is licensed under the MIT License. See `LICENSE` for more info.

---

## 🙌 Credits

Developed with ❤️ by Team Udyamita.
