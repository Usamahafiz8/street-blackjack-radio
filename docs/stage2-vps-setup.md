# Stage 2: Ordering and Setting Up the Test VPS (OVHcloud UK)

This guide is for **you** (the owner). It covers:
1. what to ask OVH before ordering;
2. creating an SSH key on your PC;
3. ordering the VPS;
4. giving me access;
5. creating the AzuraCast admin account and API key yourself, so no password or key ever goes through chat.

It takes about 30–45 minutes of your time, plus OVH's delivery time (usually minutes, sometimes a few hours).

> **Security rules for this project**
> - Never paste passwords, private keys or API keys into chat.
> - Server access is by SSH key only. Password login is switched off during setup.
> - The only secret on the server is the AzuraCast API key, in a file readable only by the server's admin user.

---

## Step 1: Ask OVH three things before you order (5 min)

OVH's VPS page says traffic is **unlimited, with no bandwidth cap**. The only exception in the small print is Asia-Pacific data centres, so the UK isn't affected. It's still worth having their answers in writing, because 24/7 audio streaming is a constant load.

Open a chat or sales ticket at **ovhcloud.com/en-gb → Contact → Sales**, or email OVH UK sales, and paste this message:

```
Hello,

I am planning to order a VPS (VPS-2 now, possibly VPS-4 later) to run an internet radio
service (AzuraCast / Icecast audio streaming, 24/7). Before ordering, please confirm:

1. UK location: can the VPS-2 and VPS-4 ranges be deployed in your UK (London) datacentre?
   If yes, what is the datacentre/region name shown in the order form?
2. Traffic fair use: the VPS page says "unlimited traffic". For audio streaming we expect
   sustained outbound traffic of roughly 10-100 Mbps now, possibly 500+ Mbps later, 24/7.
   Is there any fair-use policy, monthly limit or throttling for this kind of continuous
   streaming on a UK VPS? Is audio streaming permitted under your terms?
3. Billing: is monthly billing with no commitment available for VPS-2 in the UK, and what
   is the monthly price (ex VAT) without a 12-month commitment?

Thank you.
```

**What to do with the answers:**

| Answer | What to do |
|---|---|
| UK is available | Order in the UK (Step 3) |
| UK not available for VPS | Choose **Gravelines or Roubaix (France)**. They're about 10 ms from London, which makes no audible difference for radio. Tell me which you picked. |
| They state a fair-use limit | Send me the wording. I'll recalculate the hosting plan before Stage 3. |

Save their reply. It's part of the hosting decision record.

---

## Step 2: Create an SSH key on your PC (5 min)

An SSH key is a pair of files:
- the **private key** stays on your PC and is never shared;
- the **public key** is safe to give to OVH.

Open **PowerShell** on this PC and run:

```powershell
ssh-keygen -t ed25519 -C "sbradio-admin" -f "$env:USERPROFILE\.ssh\sbradio_ed25519"
```

When it asks for a passphrase you have two choices:

| Option | How it works | Trade-off |
|---|---|---|
| **A. No passphrase (simplest)** | Press Enter twice. I can then run setup commands from this PC. | The key file is protected only by your Windows login. Keep your PC locked, and delete or rotate the key after handover. |
| **B. Passphrase + Windows ssh-agent** | Set a passphrase, then load the key into the agent once per session. Enabling the agent needs an administrator PowerShell. | More secure, but if the agent isn't running I can't connect, and you'll have to load the key again. |

For option B:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add "$env:USERPROFILE\.ssh\sbradio_ed25519"
```

Then show the **public** key (it ends in `sbradio-admin`):

```powershell
Get-Content "$env:USERPROFILE\.ssh\sbradio_ed25519.pub"
```

Copy that single line. You'll paste it into OVH in Step 3.

---

## Step 3: Order the VPS (10 min)

> OVH changes its order pages from time to time, so the labels may differ slightly. The choices are what matter.

1. Go to **https://www.ovhcloud.com/en-gb/vps/** and choose **VPS-2**: 4 vCores, 8 GB RAM, 75 GB NVMe, about £6.29/month ex VAT. Click **Configure / Order**.
   - VPS-2 is plenty for the 2-station test.
   - For production (5 stations, 20–50 h of 320 kbps mixes each, with room to grow) I recommend **VPS-4** (200 GB disk), because media alone will be about 36 GB at launch and growing.
   - We can upgrade this VPS later, or rebuild on a new one with the scripts in this repo in about an hour.
2. **Location:** **United Kingdom (London)**, or the location agreed in Step 1.
3. **Operating system:** **Ubuntu 24.04 LTS**, plain distribution only. Don't choose a control panel such as Plesk or cPanel, and don't choose Docker pre-installed.
4. **SSH key:** if the form has an SSH key field, paste the public key from Step 2 and give it the name `sbradio-admin`.
5. **Billing / commitment:** **monthly, no commitment** for the test server.
6. **Options:** none needed. Daily backup is included, and you don't need extra IPs or a control panel.
7. Complete the order. OVH emails you when the VPS is ready, with its **IPv4 address** and the default user name (normally **`ubuntu`**).

**If there was no SSH key field in the order:**
- OVH emails a one-time password for the `ubuntu` user.
- Type it **only in your own terminal**, never in chat, and run this once from PowerShell (replace `SERVER_IP`):

```powershell
Get-Content "$env:USERPROFILE\.ssh\sbradio_ed25519.pub" | ssh ubuntu@SERVER_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Check the key works. This should log you in **without asking for a password**:

```powershell
ssh -i "$env:USERPROFILE\.ssh\sbradio_ed25519" ubuntu@SERVER_IP
```

Type `exit` to leave.

---

## Step 4: Give me access (1 min)

Send me in chat:
1. **The server's IPv4 address.**
2. **Confirmation** that the `sbradio_ed25519` key logs in as `ubuntu` (Step 3's check worked).
3. **Which domain to use for testing:**
   - **sslip.io (no DNS needed):** free hostnames built from the IP, e.g. `radio.51-89-12-34.sslip.io`. They get real HTTPS certificates. This is fine for testing.
   - **Your own subdomain:** e.g. `radio.yourdomain.com`, `api.radio.yourdomain.com` and `player.radio.yourdomain.com`, each with a DNS **A record** pointing at the server IP. Create the records before telling me.
4. **An email address for certificate expiry notices.** It goes into the server config only.

That's all I need: **no passwords, no API keys.** I connect from this PC using the key file from Step 2.

Then I'll run, in order, and report back:

| Script | What it does |
|---|---|
| `bootstrap-server.sh` | Updates; firewall; keys-only SSH; fail2ban; automatic security updates; swap |
| `install-azuracast.sh` | AzuraCast stable release, moved to internal port 8080 |
| `deploy.sh` → `up.sh` | Caddy (HTTPS), the registry API and the test player |
| `generate-test-audio.sh` | Synthetic, licence-free test mixes |

---

## Step 5: Create the AzuraCast admin account yourself (10 min)

The AzuraCast setup page is **blocked from the internet** until you've done this. That way nobody else can claim the admin account. You reach it through a private SSH tunnel.

1. In PowerShell, open the tunnel and **leave this window open** (replace `SERVER_IP`):

   ```powershell
   ssh -i "$env:USERPROFILE\.ssh\sbradio_ed25519" -L 8080:127.0.0.1:8080 ubuntu@SERVER_IP
   ```

2. In your browser go to **http://localhost:8080**. You'll see the AzuraCast setup page.
3. **Create the Super Administrator account.** Use your email and a strong, unique password, and save it in a password manager. Turn on two-factor login later under *My Account*.
4. If the wizard asks you to **create a station**, create:
   - Name: `UK Rap / Drill / Grime`
   - Short name: `uk_rap`

   Leave everything else as default. My script adopts and configures it.
5. On the **System Settings** step, set **Site Base URL** to the radio address I give you, e.g. `https://radio.51-89-12-34.sslip.io`. Leave the rest as default and save.

## Step 6: Create the API key and store it on the server (5 min)

The setup script needs an AzuraCast API key. It stays **on the server only** and is never used by the player or the registry API.

1. In AzuraCast (still at http://localhost:8080), open the menu at the top right → **My Account** → **API Keys** → **Add API Key**. Name it `provisioning`.
2. Copy the key it shows (it's only shown once).
3. In the **same PowerShell window as the tunnel**, which is also a shell on the server, paste this command and press Enter:

   ```bash
   read -rs -p "Paste AzuraCast API key, then press Enter: " K && printf 'AZURACAST_API_KEY=%s\n' "$K" > /opt/sbradio/secrets/azuracast-api.env && chmod 600 /opt/sbradio/secrets/azuracast-api.env && unset K && echo " saved"
   ```

   Paste the key when asked. Nothing appears on screen while you paste, which is normal. You'll see `saved`.
4. Tell me in chat: **"API key saved"**. Don't send the key itself.

After Stage 3 you can delete this API key in AzuraCast (*My Account → API Keys*). Nothing in the live service depends on it.

---

## Your checklist

- [ ] Asked OVH the three questions and saved the reply
- [ ] Created the `sbradio_ed25519` SSH key
- [ ] Ordered VPS-2, Ubuntu 24.04, UK, monthly
- [ ] Logged in with the key successfully
- [ ] Sent me: IP address, key confirmation, domain choice, certificate email
- [ ] (After I say AzuraCast is installed) created the admin account through the tunnel
- [ ] Created the API key, saved it on the server, told me "API key saved"
