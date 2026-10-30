# Hosting on Oracle Cloud's free tier

This runs the game on an always-on Oracle Cloud VM, so no player's laptop or phone has to stay on. It replaces
`play_windows.bat` / `play_android.sh` and ngrok. Players just open your permanent `https://` address.

Allow about 30 minutes. You need a card to sign up, for identity verification. The resources below are
labelled **Always Free** and aren't charged for.

> **Oracle may reclaim idle free VMs, and this game is very light.** A VM counts as idle if, over 7 days, its
> 95th-percentile CPU use and its network use are under 20% (and memory too, on A1 VMs). Oracle gives this rule
> in its [Always Free docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
> So [keep backups](#back-up-your-games), because a reclaimed VM would take your saved games with it. Upgrading
> the account to Pay As You Go is widely reported to stop reclamation, and Always Free resources stay free after
> upgrading, but Oracle's page doesn't promise this.

## 1. Create the VM

1. Sign up at <https://www.oracle.com/cloud/free/>. Pick a **home region** near you: you can't change it later,
   and Always Free VMs must be in it.
2. Go to **Compute → Instances → Create instance**.
3. **Image:** Canonical Ubuntu 24.04.
4. **Shape:** `VM.Standard.A1.Flex` (Arm) with 1 OCPU and 6 GB of memory. If it's out of capacity, try another
   availability domain, or use `VM.Standard.E2.1.Micro` (1 GB of memory: slower, but the setup script allows for it).
   Check that the shape is marked **Always Free-eligible**.
5. **Networking:** keep the public subnet and **assign a public IPv4 address**.
6. **SSH keys:** download the private key and keep it safe. It's your only way in.
7. Create the instance and note its **public IP address**.

## 2. Open the web ports in Oracle's network

Go to the instance's **subnet → Security → Default Security List → Add Ingress Rules** (console wording varies)
and add two rules:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

## 3. Get a free web address

Phones only allow notifications on `https://` pages, and a certificate needs a domain name.

1. Sign in at <https://www.duckdns.org> and create a subdomain, e.g. `my-xiangqi`.
2. Set its **current ip** to the VM's public IP.

## 4. Install the game

From PowerShell on your computer:

```powershell
ssh -i path\to\your-key.key ubuntu@YOUR_PUBLIC_IP
```

If Windows complains that the key's permissions are too open, move it into your `C:\Users\<you>\.ssh` folder.

Then, on the VM, using your own address and email:

```bash
git clone https://github.com/darbyxa/xiangqi.git
cd xiangqi
bash deploy/oracle/setup.sh my-xiangqi.duckdns.org you@example.com
```

It finishes with `Ready: https://my-xiangqi.duckdns.org`. Open that address, create a room and share the link
as usual. The email goes to Let's Encrypt and to the push services as your contact address.

On Android, open the address in Chrome and choose **Add to Home screen** to get an app icon.

The new address starts with no games. Games saved on your laptop or phone can be moved across the same way as a
[restore](#back-up-your-games), but both players then need to open them from the new address, where the browser
won't remember their seats. It's simplest to finish those games on the old host.

## Update to a newer version

```bash
cd ~/xiangqi
git pull
bash deploy/oracle/setup.sh my-xiangqi.duckdns.org you@example.com
```

Saved games and notification subscriptions are kept: they live in `server/data/`, which git ignores.

## Back up your games

`server/data/` holds the games (`rooms.json`) and the notification keys (`vapid.json`). Run this from your own
computer every so often:

```powershell
scp -i path\to\your-key.key -r ubuntu@my-xiangqi.duckdns.org:xiangqi/server/data xiangqi-backup
```

To restore onto a new VM, run the setup above and point DuckDNS at the new IP. Then stop the game, copy the files
back and start it again:

```powershell
ssh -i path\to\your-key.key ubuntu@my-xiangqi.duckdns.org sudo systemctl stop xiangqi
scp -i path\to\your-key.key xiangqi-backup\* ubuntu@my-xiangqi.duckdns.org:xiangqi/server/data/
ssh -i path\to\your-key.key ubuntu@my-xiangqi.duckdns.org sudo systemctl start xiangqi
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Setup stops at "No answer" | DuckDNS points at the VM's IP (`nslookup my-xiangqi.duckdns.org`), and step 2's rules exist. Caddy's log: `journalctl -u caddy -n 50` |
| Site shows an error (502) | The game's log: `journalctl -u xiangqi -n 50` |
| "Out of capacity" creating the VM | Try another availability domain, try again later, or use the E2.1.Micro shape |
| Build runs out of memory | Check swap is on with `free -h`, then run the setup script again |
