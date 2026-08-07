# bettertimer

Mobile-first On/Off interval timer (60s / 45s) with fluid fill UI.

## Local

Open `index.html` in a browser, or:

```bash
docker build -t bettertimer .
docker run --rm -p 8080:80 bettertimer
```

## Deploy

Live: https://timer.zacharylandes.com

Pushes to `main` trigger Coolify redeploy via GitHub webhook.
