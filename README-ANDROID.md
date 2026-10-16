# Playing Xiangqi on an Android phone

This guide covers the three ways to play with a phone:

| Setup | Who hosts | What the other player needs |
|---|---|---|
| **Phone ↔ phone** | one phone runs `play_android.sh` in Termux | just a browser (Chrome) |
| **Laptop ↔ phone** | the laptop runs `play_windows.bat` (easiest) | just a browser on the phone |
| **Laptop ↔ laptop** | one laptop runs `play_windows.bat` | just a browser |

Only **one** device hosts. The host runs a small game server plus an [ngrok](https://ngrok.com) tunnel that gives
it a public `https://…ngrok-free.app` address. The other player just opens that link.

Games are **saved on the host**. Either player can close the page, or the whole app, and come back later. The
host can even stop the server and start it again. You get a **notification on your phone when your opponent
moves**.

---

## What you need (once)

1. **A free ngrok account.** Sign up at <https://dashboard.ngrok.com/signup> and keep the
   [authtoken page](https://dashboard.ngrok.com/get-started/your-authtoken) handy. Only the **host** needs this.
2. On the hosting phone: the **Termux** app, installed from **F-Droid** (<https://f-droid.org/packages/com.termux/>)
   or from Termux's GitHub releases.
   > ⚠ Don't use the Google Play version of Termux. It is outdated, and its package installs fail.
3. On every phone that plays: **Chrome** (recommended), or Firefox. These browsers support notifications.

---

## A. Host on an Android phone (phone ↔ phone, or phone ↔ laptop)

### 1. First run

Open **Termux** and type these lines. Press Enter after each one:

```bash
pkg update -y && pkg install -y git
cd ~
git clone https://github.com/darbyxa/xiangqi.git
cd xiangqi
bash play_android.sh
```

> Clone into Termux's home folder (`~`), as shown above. npm cannot install into the phone's shared storage
> (`/sdcard`), and the script will refuse to run there.

The script then:

1. installs Node.js and the helpers it needs (`proot`, `curl`, certificates),
2. downloads ngrok and asks once for your **authtoken**: paste it and press Enter,
3. installs and builds the game. **The first run takes several minutes.** Later runs take seconds,
4. starts the server and the tunnel, keeps the phone awake (`termux-wake-lock`), prints the **game link** and a
   **QR code**, and opens the link in your browser.

```
════════════════════════════════════════════════════════════════
  象棋  Xiangqi is ready to play

  Game link:   https://your-name.ngrok-free.app
  ...
```

### 2. Start a game

1. In the browser that opened, tap **Visit Site** on the ngrok notice. This happens once per browser.
2. Enter your name and tap **Create room**.
3. Tap **Copy link** and send the link to your opponent by WhatsApp, SMS or similar. Or read them the 6-letter code.
4. Tap **🔕 Notify me when it's my move**, then **Allow**.

### 3. Keep it running

- **Leave Termux running in the background.** You can switch apps and turn the screen off. The wake lock keeps
  the server alive, and Termux shows a notification while it runs.
- Recommended: Android **Settings → Apps → Termux → Battery → Unrestricted** (wording varies by phone). Otherwise
  Android may stop Termux after a while.
- To stop hosting, go back to Termux and press **Ctrl+C**. Termux's extra-keys row has a CTRL key; press it, then
  `c`. Or swipe Termux away completely.

### 4. Continue later

Open Termux and run:

```bash
cd ~/xiangqi && bash play_android.sh
```

Every unfinished game comes back exactly as it was. Open the game link, and the lobby lists **Your games**. Tap
**Resume**.

> While the host is stopped, the opponent sees "Can't reach the server". Their saved game reappears as soon as the
> host starts the server again.

### Updating the game later

```bash
cd ~/xiangqi && git pull && bash play_android.sh
```

---

## B. Join from a phone (the other player)

You don't install anything.

1. Open the link the host sent you in **Chrome**. Tap **Visit Site** on the ngrok notice the first time.
2. Enter your name. If the code isn't filled in already, type it, then tap **Join room**.
3. Tap **🔕 Notify me when it's my move** → **Allow**.
4. Optional, and nice to have: Chrome menu **⋮ → Add to Home screen** (or **Install app**). Xiangqi then gets its
   own icon and opens full-screen like an app.

Now you can close Chrome. When your opponent moves, you get a notification such as **"Your move — Alice played
炮八平五."** Tapping it opens the game straight away.

---

## C. Host on a Windows laptop (laptop ↔ phone, laptop ↔ laptop)

Double-click **`play_windows.bat`** in the project folder. On the first run it installs Node.js and ngrok
(through winget) and asks for your ngrok authtoken. It then builds the game, prints the link and a QR code, and
opens the link in your browser.

- **Phone opponent:** scan the QR code shown in the window, or send them the link.
- Keep the window open while you play. Close it any time and double-click again to carry on.
- The laptop must stay awake, so don't let it sleep while your opponent might move.
- Same Wi-Fi with no ngrok: run `play_windows.bat lan` and open the printed `http://192.168…` address. On that
  address, notifications don't work, because browsers only allow them on https.

---

## Playing over days ("correspondence" style)

- **Close the page whenever you like.** No timer counts down, and nobody forfeits for being away.
- **"My games"** (top bar) takes you back to the lobby without resigning. **Leave room** resigns.
- The lobby's **Your games** list shows every game this browser is playing and whose move it is.
- Unfinished games stay saved for **30 days after the last move**.
- Notifications are per device. Tap **Notify me** on each phone or laptop you play on.

---

## Keeping the same link every time

ngrok's free plan includes one permanent domain per account. Find it on the ngrok dashboard under
**Domains** (for example `your-name.ngrok-free.app`). The script normally gets the same address each run. If the
link ever changes, the script warns you. To pin the address, create `server/.env` (on the phone:
`nano ~/xiangqi/server/.env`) containing:

```ini
NGROK_DOMAIN=your-name.ngrok-free.app
```

A fixed link matters because each browser remembers your seats **per address**. If the link changes, the games are
still saved on the host, but the browsers won't list them under the new address. Pinning the domain avoids that.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `pkg` errors such as *"repository is under maintenance"* or 404s | Run `termux-change-repo`, pick a different mirror, then run the script again. |
| *"Run this inside the Termux app"* | You're not in Termux, or you're using the Play Store build. Install Termux from F-Droid. |
| *"This folder is on shared storage"* | Clone into `~` as shown in step A1. |
| *ngrok didn't start … ERR_NGROK_108* | Free accounts can run one ngrok at a time. Stop it on your other device or laptop. |
| *ngrok rejected the authtoken* | Delete `~/.config/ngrok/ngrok.yml` and run the script again to paste a fresh token. |
| ngrok fails with a *lookup … connection refused* (DNS) error | Run `pkg install resolv-conf proot` and try again. The script runs ngrok through `termux-chroot` for this. |
| No notifications arrive | (1) Use the **https** ngrok link, not a `http://192.168…` address. (2) Allow notifications for the site in Chrome: **⋮ → Settings → Site settings → Notifications**. (3) Check that Android allows notifications for Chrome. (4) On some phones, set Chrome's battery mode to *Unrestricted* too. |
| Notification shows *"Notifications blocked"* | You tapped *Block* earlier. Change it in Chrome's site settings for the game link. |
| The opponent says the game can't be reached | Check that the host's Termux or `play_windows.bat` window is still running. Restart it if needed. Games are saved. |
| Termux gets killed after a while | Set Termux's battery mode to *Unrestricted*. Some brands (Xiaomi, Huawei, Samsung) also have an "auto-start / sleeping apps" list to exclude Termux from. |
| *"Unsupported engine"* or Node errors | Run `pkg upgrade` to update Node.js (22.12+ is required). |
